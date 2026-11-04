"""
Storage and ``LearnerUpload`` rows for files learners attach to their messages.

This module knows nothing about blocks: callers pass plain user IDs, keys and
panes. ``LearnerUpload`` is imported inside each function, because this module
is reachable from ``ai_eval/__init__.py``, which Django imports while it is
still loading apps.
"""

import codecs
import hashlib
import io
import logging
import os
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

import pypdf
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import Storage, default_storage, storages
from django.db import DatabaseError, transaction
from django.db.models import QuerySet
from django.utils import timezone
from django.utils.text import get_valid_filename

if TYPE_CHECKING:
    from .models import LearnerUpload

logger = logging.getLogger(__name__)

# Every file in a pane is sent to the model again with each later message, so
# these limits are sized for a full pane rather than a single file. At the
# default ceiling of 5 files (``DEFAULT_MAX_FILE_UPLOADS_LIMIT``), a pane holds
# at most 50 PDF pages and 20 MB (about 27 MB once base64-encoded). That stays
# within the providers' per-request limits (Claude: 32 MB and 100 PDF pages)
# and leaves room in a 128k-token context (GPT-4o) for the prompt and the
# conversation. Raising a limit or the ceiling can make every later message in
# a full pane fail.
PDF_MAX_BYTES = 4 * 1024 * 1024
PDF_MAX_PAGES = 10
# About 12k tokens per file.
TEXT_MAX_BYTES = 50 * 1024
ALLOWED_TYPES = {".pdf": "application/pdf", ".txt": "text/plain",
                 ".md": "text/markdown", ".csv": "text/csv"}
PENDING_TTL = timedelta(hours=24)
STORAGE_ALIAS = "ai_eval_uploads"
# The longest filename ``LearnerUpload.filename`` can store.
FILENAME_MAX_LENGTH = 255


def get_upload_storage() -> Storage:
    """
    Return the operator's ``STORAGES["ai_eval_uploads"]`` storage, or ``default_storage``.

    Same resolution order as edx-platform's ``resolve_storage_backend``.
    """
    if STORAGE_ALIAS in settings.STORAGES:
        return storages[STORAGE_ALIAS]
    return default_storage


class UploadRejected(Exception):
    """
    Raised when a learner's file can't be accepted.

    ``code`` is one of ``file_too_large``, ``unsupported_type`` or ``too_many_pages``.
    """

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class UploadNotFound(Exception):
    """Raised when an upload doesn't exist, or doesn't match the expected owner, block, pane or state."""


def validate_and_read(stream, filename: str, content_length: int | None) -> tuple[bytes, str]:
    """
    Read an uploaded file from ``stream`` and check its type and size.

    The declared ``content_length`` is checked before anything is read, and the
    read stops one byte past the limit, so an oversized body is never held in
    memory. A UTF-8 byte order mark is stripped from text files.

    Returns the file's bytes and its content type. Raises ``UploadRejected``.
    """
    extension = os.path.splitext(filename)[1].lower()
    if extension not in ALLOWED_TYPES:
        raise UploadRejected("unsupported_type")
    content_type = ALLOWED_TYPES[extension]
    is_pdf = content_type == "application/pdf"

    max_bytes = PDF_MAX_BYTES if is_pdf else TEXT_MAX_BYTES
    if content_length is None or content_length > max_bytes:
        raise UploadRejected("file_too_large")
    file_bytes = stream.read(max_bytes + 1)
    if len(file_bytes) > max_bytes:
        raise UploadRejected("file_too_large")

    if is_pdf:
        _check_pdf(file_bytes)
        return file_bytes, content_type
    return _text_without_bom(file_bytes), content_type


def _check_pdf(file_bytes: bytes) -> None:
    """Reject bytes that aren't a readable, unencrypted PDF of at most ``PDF_MAX_PAGES`` pages."""
    if not file_bytes.startswith(b"%PDF-"):
        raise UploadRejected("unsupported_type")
    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        # Checked explicitly: pypdf opens PDFs encrypted with an empty user password without complaint.
        if reader.is_encrypted:
            raise UploadRejected("unsupported_type")
        page_count = len(reader.pages)
    except pypdf.errors.PyPdfError as error:
        raise UploadRejected("unsupported_type") from error
    if page_count > PDF_MAX_PAGES:
        raise UploadRejected("too_many_pages")


def _text_without_bom(file_bytes: bytes) -> bytes:
    """Return the text file's bytes without a UTF-8 byte order mark, rejecting anything that isn't UTF-8."""
    text_bytes = file_bytes.removeprefix(codecs.BOM_UTF8)
    try:
        text_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise UploadRejected("unsupported_type") from error
    return text_bytes


def count_pending(user_id: int, usage_key: str, pane: str) -> int:
    """Count the learner's pending uploads in this block and pane, ignoring those past ``PENDING_TTL``."""
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    return LearnerUpload.objects.filter(
        user_id=user_id,
        usage_key=usage_key,
        pane=pane,
        state=LearnerUpload.State.PENDING,
        created__gte=timezone.now() - PENDING_TTL,
    ).count()


def save_upload(
    *,
    user_id: int,
    anonymous_user_id: str,
    course_key: str,
    usage_key: str,
    pane: str,
    filename: str,
    file_bytes: bytes,
    content_type: str,
) -> "LearnerUpload":
    """
    Store the file and create its pending ``LearnerUpload`` row.

    The storage path uses the anonymous user ID and a sanitized filename. The
    original filename is kept in the row for display. The object is written
    before the row is inserted, which relies on XBlock handler views not running
    in a transaction (``@transaction.non_atomic_requests``), so the object is
    deleted again if the insert fails.
    """
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    upload_id = uuid.uuid4()
    storage = get_upload_storage()
    requested_path = (
        f"ai_eval/uploads/{course_key}/{usage_key}/{anonymous_user_id}/{upload_id}/{get_valid_filename(filename)}"
    )
    # The storage may change the name (for example, to avoid overwriting), so keep the one it returns.
    storage_path = storage.save(requested_path, ContentFile(file_bytes))
    try:
        upload = LearnerUpload.objects.create(
            upload_id=upload_id,
            user_id=user_id,
            course_key=course_key,
            usage_key=usage_key,
            pane=pane,
            storage_path=storage_path,
            filename=filename,
            content_type=content_type,
            size=len(file_bytes),
            sha256=hashlib.sha256(file_bytes).hexdigest(),
        )
    except DatabaseError:
        storage.delete(storage_path)
        raise
    logger.info(
        "Saved learner upload %s (usage %s, pane %s, %d bytes)", upload_id, usage_key, pane, len(file_bytes),
    )
    return upload


def get_owned_uploads(
    user_id: int, usage_key: str, pane: str, upload_ids: list[str], state: str,
) -> list["LearnerUpload"]:
    """
    Return the learner's uploads with these IDs, in the order given.

    Every upload must belong to this learner, block and pane and be in ``state``.
    If any ID doesn't match, is repeated or isn't a UUID, raises ``UploadNotFound``
    without saying which check failed.
    """
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    try:
        requested_ids = [uuid.UUID(upload_id) for upload_id in upload_ids]
    except ValueError as error:
        raise UploadNotFound() from error
    uploads_by_id = {
        upload.upload_id: upload
        for upload in LearnerUpload.objects.filter(
            user_id=user_id, usage_key=usage_key, pane=pane, state=state, upload_id__in=requested_ids,
        )
    }
    if len(uploads_by_id) != len(requested_ids):
        raise UploadNotFound()
    return [uploads_by_id[upload_id] for upload_id in requested_ids]


def _delete_uploads(uploads: QuerySet) -> int:
    """
    Delete the stored objects of the uploads in the ``uploads`` queryset, then their rows. Returns the number deleted.

    The objects go first, so if deleting one fails, every row is kept and a re-run
    (for example, a retried retirement step) deletes the rest. Storage backends
    treat deleting a missing object as a no-op, and a row whose object is already
    gone is harmless: reading it falls back to a note. Rows are deleted by primary
    key, so a row inserted after the paths were collected is never deleted
    without its object.
    """
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    storage_paths_by_pk = dict(uploads.values_list("pk", "storage_path"))
    storage = get_upload_storage()
    for storage_path in storage_paths_by_pk.values():
        storage.delete(storage_path)
    LearnerUpload.objects.filter(pk__in=storage_paths_by_pk).delete()
    return len(storage_paths_by_pk)


def delete_pending_upload(user_id: int, usage_key: str, pane: str, upload_id: str) -> None:
    """
    Delete one of the learner's pending uploads in this block and pane.

    Raises ``UploadNotFound`` if ``upload_id`` isn't such an upload.
    """
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    [upload] = get_owned_uploads(user_id, usage_key, pane, [upload_id], state=LearnerUpload.State.PENDING)
    _delete_uploads(LearnerUpload.objects.filter(pk=upload.pk))


def delete_pending_uploads_in_block(user_id: int, usage_key: str, older_than: timedelta | None = None) -> int:
    """
    Delete the learner's pending uploads in this block, in every pane. Returns the number deleted.

    With ``older_than``, only uploads created more than that long ago are
    deleted. Sent uploads are never touched.
    """
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    pending_uploads = LearnerUpload.objects.filter(
        user_id=user_id, usage_key=usage_key, state=LearnerUpload.State.PENDING,
    )
    if older_than is not None:
        pending_uploads = pending_uploads.filter(created__lt=timezone.now() - older_than)
    return _delete_uploads(pending_uploads)


def mark_sent(upload_ids: list[str]) -> bool:
    """
    Mark pending uploads as sent, all or none.

    Returns ``False``, marking none, if any of them is no longer pending (for
    example, another request is already sending it).
    """
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    with transaction.atomic():
        marked_count = LearnerUpload.objects.filter(
            upload_id__in=upload_ids, state=LearnerUpload.State.PENDING,
        ).update(state=LearnerUpload.State.SENT)
        if marked_count != len(upload_ids):
            transaction.set_rollback(True)
            return False
    return True


def mark_pending(upload_ids: list[str]) -> None:
    """Mark uploads as pending again, after the message they were sent with failed."""
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    LearnerUpload.objects.filter(upload_id__in=upload_ids).update(state=LearnerUpload.State.PENDING)


def read_upload_bytes(upload_id: str) -> bytes:
    """Return the stored bytes of an upload. Raises ``UploadNotFound`` if the row or the object is gone."""
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    try:
        upload = LearnerUpload.objects.get(upload_id=upload_id)
    except LearnerUpload.DoesNotExist as error:
        raise UploadNotFound() from error
    try:
        with get_upload_storage().open(upload.storage_path, "rb") as stored_file:
            return stored_file.read()
    except FileNotFoundError as error:
        raise UploadNotFound() from error


def retire_user_uploads(user_id: int) -> int:
    """
    Delete every upload of a retired user, in all courses and states. Returns the number deleted.

    If a stored object can't be deleted, the error propagates and the rows are
    kept, so re-running the retirement step finishes the job.
    """
    from .models import LearnerUpload  # pylint: disable=import-outside-toplevel
    return _delete_uploads(LearnerUpload.objects.filter(user_id=user_id))
