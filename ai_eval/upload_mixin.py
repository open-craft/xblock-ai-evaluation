"""
Learner file uploads for the AI blocks: settings, gating, slot counting and handlers.

``LearnerUploadMixin`` is shared by Short Answer and Coaching. Anything stored
(files and ``LearnerUpload`` rows) goes through ``upload_storage``.
"""

import json
import logging
import typing
import unicodedata
from urllib.parse import unquote

import pydantic
from django.utils.translation import gettext_noop as _
from litellm.utils import supports_pdf_input
from webob import Response
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError

from . import upload_storage
from .compat import is_masquerading_as_specific_learner, set_custom_attribute
from .llm import get_llm_service
from .llm_services import CustomLLMService
from .upload_storage import (
    ALLOWED_TYPES,
    FILENAME_MAX_LENGTH,
    PDF_MAX_BYTES,
    PDF_MAX_PAGES,
    PENDING_TTL,
    TEXT_MAX_BYTES,
    UploadNotFound,
    UploadRejected,
)

logger = logging.getLogger(__name__)

# Sized together with the per-file limits in ``upload_storage``: a pane's files
# are re-sent on every turn, so the ceiling bounds the size of every request.
DEFAULT_MAX_FILE_UPLOADS_LIMIT = 5

# The Unicode bidirectional classes of the embedding, override and isolate characters, which reorder how text displays.
BIDI_FORMATTING_CLASSES = {"LRE", "RLE", "LRO", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI"}

# Status code and message of every upload error response, by error code.
UPLOAD_ERRORS = {
    "invalid_request": (400, _("Invalid upload request.")),
    # An upload ID that isn't one of the learner's pending uploads in this pane (it may have been sent, deleted or
    # purged). The frontend drops such files' chips, since they can't be sent or removed.
    "invalid_upload": (400, _("Invalid upload.")),
    "method_not_allowed": (405, _("Files must be uploaded with PUT.")),
    "uploads_disabled": (403, _("File uploads are not available.")),
    "too_many_files": (409, _("You've reached your file upload limit for this conversation.")),
    "file_too_large": (413, _("This file is too large.")),
    "unsupported_type": (400, _("This file type isn't supported.")),
    "too_many_pages": (422, _("This PDF has too many pages.")),
}


class PaneUploadFields(typing.NamedTuple):
    """Names of the author fields that turn uploads on and set the file limit for one pane."""

    allow_uploads_field: str
    max_uploads_field: str


class DeleteUploadRequest(pydantic.BaseModel):
    """Body of a ``delete_upload`` request."""

    pane: pydantic.StrictStr
    upload_id: pydantic.StrictStr


def _json_response(status_code: int, body: dict, **response_kwargs) -> Response:
    """Return a JSON response from a raw (non-JSON) handler."""
    return Response(
        json.dumps(body), status_code=status_code, content_type="application/json", charset="utf-8", **response_kwargs,
    )


class LearnerUploadError(JsonHandlerError):
    """
    An upload error from ``UPLOAD_ERRORS``. Its response body carries the ``code``, so the frontend can show the
    matching alert.
    """

    def __init__(self, code: str):
        status_code, message = UPLOAD_ERRORS[code]
        super().__init__(status_code, message)
        self.code = code

    def get_response(self, **kwargs) -> Response:
        return _json_response(self.status_code, {"code": self.code, "error": self.message}, **kwargs)


class LearnerUploadMixin:
    """
    Upload behavior shared by the blocks whose learners can attach files.

    Each block supplies ``_pane_fields`` (its panes and their author fields)
    and ``_current_pane_messages``.
    """

    _pane_fields: dict[str, PaneUploadFields]

    def _current_pane_messages(self, pane: str) -> list[dict]:
        """Return the learner's messages in the current session for ``pane``."""
        raise NotImplementedError

    def _pane_takes_messages(self, pane: str) -> bool:
        """Whether the learner can still send a message in ``pane`` (for example, the session isn't finished)."""
        raise NotImplementedError

    # Settings and gating

    def _max_uploads_ceiling(self) -> int:
        """The operator's cap on every Max File Uploads field (``MAX_FILE_UPLOADS_LIMIT``)."""
        return self._positive_int_setting("MAX_FILE_UPLOADS_LIMIT", DEFAULT_MAX_FILE_UPLOADS_LIMIT)

    def _uploads_site_enabled(self) -> bool:
        """Whether the operator turned learner uploads on (``LEARNER_UPLOADS_ENABLED``)."""
        return self._is_truthy(self._get_ai_eval_setting("LEARNER_UPLOADS_ENABLED"))

    def _model_accepts_files(self, model: str | None = None) -> bool:
        """
        Whether the model can be sent files. Defaults to this block's stored ``model``.

        The model is resolved first, because a ``DEPRECATED_MODELS`` alias can
        change the runtime model after the author saves. The custom LLM service
        flattens messages to a single string, so it can't take files.
        """
        model = self.model if model is None else model
        return not isinstance(get_llm_service(), CustomLLMService) and supports_pdf_input(self._resolve_model(model))

    def _upload_limit(self, pane: str) -> int:
        """Return the author's Max File Uploads for ``pane``, capped at the operator's ceiling."""
        return min(getattr(self, self._pane_fields[pane].max_uploads_field), self._max_uploads_ceiling())

    def _uploads_available(self, pane: str) -> bool:
        """Whether learners can upload new files to ``pane``: site switch, author toggle and model all allow it."""
        enabled_by_author = getattr(self, self._pane_fields[pane].allow_uploads_field)
        return self._uploads_site_enabled() and enabled_by_author and self._model_accepts_files()

    # Identity

    def _current_user_attributes(self) -> dict:
        """Return the platform attributes of the current user from the XBlock user service."""
        return self.runtime.service(self, "user").get_current_user().opt_attrs

    def _user_id(self) -> int:
        return self._current_user_attributes()["edx-platform.user_id"]

    def _anonymous_user_id(self) -> str:
        """The course-specific anonymous user ID, used in storage paths instead of the user ID."""
        return self._current_user_attributes()["edx-platform.anonymous_user_id"]

    def _usage_key_str(self) -> str:
        return str(self.scope_ids.usage_id)

    def _course_key_str(self) -> str:
        return str(self.scope_ids.usage_id.course_key)

    def _in_studio_preview(self) -> bool:
        """Whether the block is rendered in Studio, where there is no learner to own uploads."""
        # Studio binds the preview to the author's user ID, so the user ID can't
        # tell Studio apart from the LMS. Studio's preview runtime sets
        # ``is_author_mode`` (for rendering and for handler calls); other runtimes
        # don't have the attribute.
        return getattr(self.runtime, "is_author_mode", False)

    def _viewer_is_learner(self) -> bool:
        """
        Whether the viewer is the learner the block is bound to, so uploads can be made, counted and deleted.

        Not in Studio preview, and not while staff view the course as a specific learner. The LMS keeps a
        masquerading staff member's changes out of the learner's state, but uploads live in the database and
        storage, so they would land in (or, on reset, delete from) the learner's real files.
        """
        return not self._in_studio_preview() and not is_masquerading_as_specific_learner(
            self.scope_ids.usage_id.course_key,
        )

    # Slot counting

    def _sent_upload_count(self, pane: str) -> int:
        """Count the files on the current session's messages in ``pane``."""
        return sum(len(message.get("attachments", [])) for message in self._current_pane_messages(pane))

    def _uploads_used(self, pane: str) -> int:
        """Count the files on the current session's messages in ``pane``, plus the learner's pending uploads."""
        pending_count = upload_storage.count_pending(self._user_id(), self._usage_key_str(), pane)
        return self._sent_upload_count(pane) + pending_count

    def _remaining_uploads(self, pane: str) -> int:
        return max(self._upload_limit(pane) - self._uploads_used(pane), 0)

    def _remaining_uploads_by_pane(self) -> dict[str, int]:
        """Return the remaining uploads of every pane where uploads are available (none unless a learner is viewing)."""
        if not self._viewer_is_learner():
            return {}
        return {pane: self._remaining_uploads(pane) for pane in self._pane_fields if self._uploads_available(pane)}

    def _discard_pending_uploads(self) -> None:
        """Delete the learner's pending uploads in every pane of this block. Called on reset."""
        # Only pending (never sent) uploads are deleted here. Sent files are kept on
        # purpose (v1 decision): slot counting doesn't need them deleted, nothing reads
        # them after the session ends, and deletion can be added later but can't be
        # undone. Revisit that decision before changing this to delete sent files.
        if not self._viewer_is_learner():
            return
        upload_storage.delete_pending_uploads_in_block(self._user_id(), self._usage_key_str())

    # Payloads

    def _learner_uploads_payload(self) -> dict:
        """Return the ``uploads`` object of the student view payload: per-pane state and the per-file limits."""
        return {
            **{pane: self._pane_upload_state(pane) for pane in self._pane_fields},
            "pdf_max_bytes": PDF_MAX_BYTES,
            "pdf_max_pages": PDF_MAX_PAGES,
            "text_max_bytes": TEXT_MAX_BYTES,
            "accept": ",".join(ALLOWED_TYPES),
        }

    def _pane_upload_state(self, pane: str) -> dict:
        """
        Return whether ``pane`` takes uploads and, if it does, its limit and remaining uploads.

        Nothing is counted unless the viewer is the learner (see ``_viewer_is_learner``).
        """
        if not self._viewer_is_learner() or not self._uploads_available(pane):
            return {"enabled": False}
        return {"enabled": True, "limit": self._upload_limit(pane), "remaining": self._remaining_uploads(pane)}

    def _studio_payload_meta(self) -> dict[str, typing.Any]:
        """
        Add whether learner uploads are on site-wide, so Studio shows the upload fields only then,
        and the operator's ceiling, so Studio checks Max File Uploads like the server does.
        """
        return {
            **super()._studio_payload_meta(),
            "learner_uploads_enabled": self._uploads_site_enabled(),
            "max_file_uploads_ceiling": self._max_uploads_ceiling(),
        }

    # Studio validation

    def _collect_studio_validation_issues(self, data) -> tuple[dict[str, list[str]], list[str]]:
        """
        Add the upload field rules to the block's Studio validation.

        The upload fields are hidden in Studio while the site switch is off, so
        they are only checked when it's on, and only for panes with uploads turned on.
        """
        validation_errors, validation_warnings = super()._collect_studio_validation_issues(data)
        if not self._uploads_site_enabled():
            return validation_errors, validation_warnings

        ceiling = self._max_uploads_ceiling()
        for fields in self._pane_fields.values():
            if not getattr(data, fields.allow_uploads_field):
                continue
            max_uploads = getattr(data, fields.max_uploads_field)
            if max_uploads is None or not 1 <= max_uploads <= ceiling:
                self._add_studio_validation_error(
                    validation_errors,
                    fields.max_uploads_field,
                    _("Max File Uploads must be an integer between 1 and {ceiling}.").format(ceiling=ceiling),
                )
            if not self._model_accepts_files(data.model):
                self._add_studio_validation_error(
                    validation_errors,
                    fields.allow_uploads_field,
                    _("The selected model can't read files. Choose another model or turn off File Upload."),
                )
        return validation_errors, validation_warnings

    # Handlers

    @XBlock.handler
    def upload_file(self, request, suffix=""):  # pylint: disable=unused-argument
        """
        Store one learner file as a pending upload.

        The body is the raw file, sent with PUT. A multipart POST would be capped
        by the LMS's ``STUDENT_FILEUPLOAD_MAX_SIZE``. The pane comes in the query
        string. The filename comes percent-encoded in the ``X-Upload-Filename``
        header, because the LMS tracking log and proxy access logs record query
        strings, and a filename can contain personal details.
        """
        if not self._viewer_is_learner():
            return self._upload_error_response("uploads_disabled")
        if request.method != "PUT":
            return self._upload_error_response("method_not_allowed")
        pane = request.GET.get("pane")
        filename = unquote(request.headers.get("X-Upload-Filename", ""))
        if pane not in self._pane_fields or not _is_valid_filename(filename):
            return self._upload_error_response("invalid_request")
        set_custom_attribute("ai_eval_upload_pane", pane)
        set_custom_attribute("ai_eval_upload_size", request.content_length)
        # A file the learner could never send would only use up a slot.
        if not self._uploads_available(pane) or not self._pane_takes_messages(pane):
            return self._upload_error_response("uploads_disabled")

        user_id, usage_key = self._user_id(), self._usage_key_str()
        purged_count = upload_storage.delete_pending_uploads_in_block(user_id, usage_key, older_than=PENDING_TTL)
        if purged_count:
            logger.info("Purged %d abandoned pending uploads (usage %s)", purged_count, usage_key)

        limit = self._upload_limit(pane)
        uploads_used = self._uploads_used(pane)
        if uploads_used >= limit:
            return self._upload_error_response("too_many_files")
        try:
            file_bytes, content_type = upload_storage.validate_and_read(
                request.body_file, filename, request.content_length,
            )
        except UploadRejected as rejection:
            return self._upload_error_response(rejection.code)

        upload = upload_storage.save_upload(
            user_id=user_id,
            anonymous_user_id=self._anonymous_user_id(),
            course_key=self._course_key_str(),
            usage_key=usage_key,
            pane=pane,
            filename=filename,
            file_bytes=file_bytes,
            content_type=content_type,
        )
        return _json_response(200, {
            "upload_id": str(upload.upload_id),
            "filename": upload.filename,
            "content_type": upload.content_type,
            "remaining": limit - uploads_used - 1,
        })

    def _upload_error_response(self, code: str) -> Response:
        """Return the ``upload_file`` error response for ``code``, and record the rejection."""
        set_custom_attribute("ai_eval_upload_rejected", code)
        logger.info("Rejected learner upload (usage %s): %s", self._usage_key_str(), code)
        return LearnerUploadError(code).get_response()

    @XBlock.json_handler
    def delete_upload(self, data, suffix=""):  # pylint: disable=unused-argument
        """
        Delete one of the learner's pending uploads.

        Not gated on uploads being available: if gating changes while a learner
        has pending files, they can still remove them.
        """
        if not self._viewer_is_learner():
            raise LearnerUploadError("uploads_disabled")
        try:
            delete_request = DeleteUploadRequest.model_validate(data)
            upload_storage.delete_pending_upload(
                self._user_id(), self._usage_key_str(), delete_request.pane, delete_request.upload_id,
            )
        except (pydantic.ValidationError, UploadNotFound) as error:
            # One message for every case, so the response doesn't reveal which check failed.
            raise LearnerUploadError("invalid_upload") from error
        return {"remaining": self._remaining_uploads(delete_request.pane)}


def _is_valid_filename(filename: str) -> bool:
    """
    Whether the browser-supplied filename can be stored and shown: not empty, short
    enough for ``LearnerUpload.filename``, and free of control characters. Some
    databases refuse NUL, and bidirectional formatting characters make a name
    display as something else (``invoice\u202efdp.txt`` shows as ``invoicetxt.pdf``).
    """
    has_control_characters = any(
        unicodedata.category(character) == "Cc" or unicodedata.bidirectional(character) in BIDI_FORMATTING_CLASSES
        for character in filename
    )
    return 0 < len(filename) <= FILENAME_MAX_LENGTH and not has_control_characters
