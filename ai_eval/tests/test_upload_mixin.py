"""Tests for the learner upload behavior the Short Answer and Coaching blocks share."""
# pylint: disable=protected-access

import logging
from datetime import timedelta
from unittest.mock import Mock, call, patch
from urllib.parse import quote, urlencode

import pytest
import time_machine
from django.utils import timezone
from webob import Request
from xblock.exceptions import JsonHandlerError
from xblock.field_data import DictFieldData

from ai_eval import CoachAIEvalXBlock, ShortAnswerAIEvalXBlock, upload_storage
from ai_eval.llm_services import CustomLLMService
from ai_eval.models import LearnerUpload
from ai_eval.supported_models import SupportedModels
from ai_eval.tests.test_upload_storage import make_pdf_bytes
from ai_eval.tests.xblock_fakes import (
    COURSE_KEY,
    LEARNER_ANONYMOUS_ID,
    LEARNER_USER_ID,
    StudioPreviewRuntime,
    ToyRuntime,
    learner_scope_ids,
)

UPLOADS_ON = {"LEARNER_UPLOADS_ENABLED": True}

SHORTANSWER_FIELDS = {
    "model": SupportedModels.GPT4O.value,
    "model_api_key": "test-key",
    "question": "What did you learn?",
    "allow_reset": True,
    "allow_learner_uploads": True,
    "max_file_uploads": 3,
}

COACH_FIELDS = {
    "model": SupportedModels.GPT4O.value,
    "model_api_key": "test-key",
    "allow_reset": True,
    "workspace_allow_learner_uploads": True,
    "workspace_max_file_uploads": 3,
    "coach_allow_learner_uploads": True,
    "coach_max_file_uploads": 3,
}


def make_block(block_class, fields, *, settings=None, scope_ids=None, runtime=None):
    """Return a block with these field values and ``ai_eval`` settings (uploads on by default)."""
    block_type = "shortanswer" if block_class is ShortAnswerAIEvalXBlock else "coach"
    block = block_class(runtime or ToyRuntime(), DictFieldData(fields), scope_ids or learner_scope_ids(block_type))
    block._get_settings = Mock(return_value=UPLOADS_ON if settings is None else settings)
    return block


def make_shortanswer_block(*, settings=None, scope_ids=None, runtime=None, **fields):
    return make_block(
        ShortAnswerAIEvalXBlock,
        {**SHORTANSWER_FIELDS, **fields},
        settings=settings,
        scope_ids=scope_ids,
        runtime=runtime,
    )


def make_coach_block(*, settings=None, scope_ids=None, runtime=None, **fields):
    return make_block(
        CoachAIEvalXBlock, {**COACH_FIELDS, **fields}, settings=settings, scope_ids=scope_ids, runtime=runtime,
    )


def upload_request(file_bytes=b"my notes", *, pane="shortanswer", filename="notes.txt", method="PUT"):
    """Return the raw ``upload_file`` request the frontend sends."""
    return Request.blank(
        f"/?{urlencode({'pane': pane})}",
        method=method,
        body=file_bytes,
        headers={"X-Upload-Filename": quote(filename)},
    )


def save_block_upload(
    block, pane, *, user_id=LEARNER_USER_ID, filename="notes.txt", file_bytes=b"my notes", content_type="text/plain",
):
    """Save a pending upload for ``block`` and return it."""
    return upload_storage.save_upload(
        user_id=user_id,
        anonymous_user_id=LEARNER_ANONYMOUS_ID,
        course_key=COURSE_KEY,
        usage_key=block._usage_key_str(),
        pane=pane,
        filename=filename,
        file_bytes=file_bytes,
        content_type=content_type,
    )


def attachment_entry(upload):
    """Return the session-state attachment entry of an upload."""
    return {"upload_id": str(upload.upload_id), "filename": upload.filename, "content_type": upload.content_type}


def save_sent_block_upload(block, pane, *, filename="notes.txt"):
    """Save an upload for ``block``, mark it sent, and return its attachment entry for session state."""
    upload = save_block_upload(block, pane, filename=filename)
    upload_storage.mark_sent([str(upload.upload_id)])
    return attachment_entry(upload)


def shortanswer_message_with_attachments(attachments):
    return {"source": "user", "content": "see attached", "attachments": attachments}


def coach_fragment_with_attachments(character_index, attachments):
    return {
        "character_index": character_index,
        "user_message": "see attached",
        "character_message": "thanks",
        "attachments": attachments,
    }


def pending_upload_count(block):
    return LearnerUpload.objects.filter(
        usage_key=block._usage_key_str(), state=LearnerUpload.State.PENDING,
    ).count()


# Gating


@pytest.mark.django_db
def test_upload_file_rejected_when_site_switch_off():
    block = make_shortanswer_block(settings={})

    response = block.upload_file(upload_request())

    assert response.status_code == 403
    assert response.json["code"] == "uploads_disabled"
    assert not LearnerUpload.objects.exists()


@pytest.mark.django_db
def test_upload_file_rejected_when_author_toggle_off():
    block = make_shortanswer_block(allow_learner_uploads=False)

    response = block.upload_file(upload_request())

    assert response.status_code == 403
    assert response.json["code"] == "uploads_disabled"


@pytest.mark.django_db
def test_upload_file_rejected_when_model_lacks_pdf_support():
    """The runtime model decides: a ``DEPRECATED_MODELS`` alias can point a saved model at one without PDF input."""
    block = make_shortanswer_block()
    deprecated_models = {"DEPRECATED_MODELS": {SupportedModels.GPT4O.value: "ollama/llama2"}}
    with patch(
        "ai_eval.supported_models.get_site_configuration_value",
        side_effect=lambda _settings_key, config_key: deprecated_models.get(config_key),
    ):
        response = block.upload_file(upload_request())

    assert block.resolved_model == "ollama/llama2"
    assert response.status_code == 403
    assert response.json["code"] == "uploads_disabled"


@pytest.mark.django_db
def test_upload_file_rejected_for_custom_llm_service():
    block = make_shortanswer_block()
    with patch("ai_eval.upload_mixin.get_llm_service", return_value=Mock(spec=CustomLLMService)):
        response = block.upload_file(upload_request())

    assert response.status_code == 403
    assert response.json["code"] == "uploads_disabled"


@pytest.mark.django_db
def test_upload_file_rejected_when_no_responses_remain():
    block = make_shortanswer_block(max_responses=1, sessions=[[
        {"source": "user", "content": "first"},
        {"source": "llm", "content": "feedback"},
    ]])

    response = block.upload_file(upload_request())

    assert response.status_code == 403
    assert response.json["code"] == "uploads_disabled"
    assert not LearnerUpload.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize("pane", ["workspace", "coach"])
def test_upload_file_rejected_after_coaching_session_finished(pane):
    block = make_coach_block()
    block._get_active_session()["finished"] = True

    response = block.upload_file(upload_request(pane=pane))

    assert response.status_code == 403
    assert response.json["code"] == "uploads_disabled"
    assert not LearnerUpload.objects.exists()


@pytest.mark.django_db
def test_upload_file_workspace_rejected_without_attempts_coach_accepted():
    block = make_coach_block(max_attempts=1)
    block._get_active_session()["attempts_used"] = 1

    workspace_response = block.upload_file(upload_request(pane="workspace"))
    coach_response = block.upload_file(upload_request(pane="coach"))

    assert workspace_response.json["code"] == "uploads_disabled"
    assert coach_response.status_code == 200


def test_upload_file_rejected_in_studio_preview():
    block = make_shortanswer_block(runtime=StudioPreviewRuntime())

    response = block.upload_file(upload_request())

    assert response.status_code == 403
    assert response.json["code"] == "uploads_disabled"


def masquerading_as_learner():
    """Patch the block's view of the request as staff viewing the course as the learner it's bound to."""
    return patch("ai_eval.upload_mixin.is_masquerading_as_specific_learner", return_value=True)


def test_upload_file_rejected_while_masquerading():
    block = make_shortanswer_block()

    with masquerading_as_learner():
        response = block.upload_file(upload_request())

    assert response.status_code == 403
    assert response.json["code"] == "uploads_disabled"


def test_payload_uploads_disabled_while_masquerading():
    block = make_coach_block()

    with masquerading_as_learner(), \
            patch.object(block.runtime, "handler_url", side_effect=lambda _block, name: f"/handler/{name}"):
        fragment = block.student_view()

    uploads_payload = fragment.json_init_args["initial_state"]["uploads"]
    assert uploads_payload["workspace"] == {"enabled": False}
    assert uploads_payload["coach"] == {"enabled": False}


@pytest.mark.django_db
def test_send_with_files_rejected_while_masquerading():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")

    with masquerading_as_learner(), pytest.raises(JsonHandlerError) as error:
        block.get_response.__wrapped__(block, {"user_input": "", "upload_ids": [str(upload.upload_id)]})

    assert error.value.get_response().json["code"] == "uploads_disabled"
    assert pending_upload_count(block) == 1


@pytest.mark.django_db
@pytest.mark.parametrize("block_type", ["shortanswer", "coach"])
def test_reset_while_masquerading_keeps_learner_pending_uploads(block_type):
    if block_type == "shortanswer":
        block = make_shortanswer_block()
        save_block_upload(block, "shortanswer")
        reset_handler = block.reset
    else:
        block = make_coach_block()
        save_block_upload(block, "workspace")
        reset_handler = block.reset_all

    with masquerading_as_learner():
        reset_handler.__wrapped__(block, {})

    assert pending_upload_count(block) == 1


@pytest.mark.django_db
@pytest.mark.parametrize("render_view", ["student_view", "author_view"])
def test_payload_uploads_disabled_in_studio_preview_without_db_query(render_view, django_assert_num_queries):
    block = make_coach_block(runtime=StudioPreviewRuntime())

    with django_assert_num_queries(0), \
            patch.object(block.runtime, "handler_url", side_effect=lambda _block, name: f"/handler/{name}"):
        fragment = getattr(block, render_view)()

    uploads_payload = fragment.json_init_args["initial_state"]["uploads"]
    assert uploads_payload["workspace"] == {"enabled": False}
    assert uploads_payload["coach"] == {"enabled": False}
    assert fragment.json_init_args["handler_urls"]["upload_file"] == "/handler/upload_file"
    assert fragment.json_init_args["handler_urls"]["delete_upload"] == "/handler/delete_upload"


@pytest.mark.django_db
def test_payload_reports_limit_and_remaining_for_enabled_panes():
    block = make_coach_block(coach_allow_learner_uploads=False)
    save_block_upload(block, "workspace")

    uploads_payload = block._learner_uploads_payload()

    assert uploads_payload == {
        "workspace": {"enabled": True, "limit": 3, "remaining": 2},
        "coach": {"enabled": False},
        "pdf_max_bytes": 4 * 1024 * 1024,
        "pdf_max_pages": 10,
        "text_max_bytes": 50 * 1024,
        "accept": ".pdf,.txt,.md,.csv",
    }


@pytest.mark.django_db
def test_pane_limit_capped_at_ceiling():
    block = make_shortanswer_block(max_file_uploads=8, settings={**UPLOADS_ON, "MAX_FILE_UPLOADS_LIMIT": 4})

    assert block._learner_uploads_payload()["shortanswer"] == {"enabled": True, "limit": 4, "remaining": 4}


# Upload and delete


@pytest.mark.django_db
def test_upload_file_rejects_over_limit_counting_sent_and_pending():
    block = make_shortanswer_block()
    block.sessions = [[shortanswer_message_with_attachments([save_sent_block_upload(block, "shortanswer")])]]
    save_block_upload(block, "shortanswer")
    save_block_upload(block, "shortanswer")

    response = block.upload_file(upload_request())

    assert response.status_code == 409
    assert response.json["code"] == "too_many_files"
    assert pending_upload_count(block) == 2


@pytest.mark.django_db
def test_upload_file_success_returns_metadata_and_remaining():
    block = make_shortanswer_block()
    save_block_upload(block, "shortanswer")

    with patch("ai_eval.upload_mixin.set_custom_attribute") as set_custom_attribute:
        response = block.upload_file(upload_request(b"\xef\xbb\xbfmy notes", filename="My notes.txt"))

    assert response.status_code == 200
    upload = LearnerUpload.objects.get(upload_id=response.json["upload_id"])
    assert response.json == {
        "upload_id": str(upload.upload_id),
        "filename": "My notes.txt",
        "content_type": "text/plain",
        "remaining": 1,
    }
    assert upload.user_id == LEARNER_USER_ID
    assert upload.course_key == COURSE_KEY
    assert upload.usage_key == block._usage_key_str()
    assert upload.pane == "shortanswer"
    assert f"/{LEARNER_ANONYMOUS_ID}/" in upload.storage_path
    assert upload_storage.read_upload_bytes(str(upload.upload_id)) == b"my notes"
    set_custom_attribute.assert_has_calls([
        call("ai_eval_upload_pane", "shortanswer"),
        call("ai_eval_upload_size", 11),
    ])


@pytest.mark.django_db
def test_upload_file_reads_percent_encoded_filename_header():
    """The frontend percent-encodes the filename into a header, since headers must be ASCII."""
    block = make_shortanswer_block()

    response = block.upload_file(upload_request(filename="Résumé notes.txt"))

    assert response.status_code == 200
    assert response.json["filename"] == "Résumé notes.txt"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "request_kwargs,status_code,code",
    [
        ({"filename": "notes.docx"}, 400, "unsupported_type"),
        ({"file_bytes": b"x" * (50 * 1024 + 1)}, 413, "file_too_large"),
        ({"file_bytes": make_pdf_bytes(page_count=11), "filename": "long.pdf"}, 422, "too_many_pages"),
        ({"pane": "workspace"}, 400, "invalid_request"),
        ({"filename": ""}, 400, "invalid_request"),
        ({"filename": "n" * 252 + ".txt"}, 400, "invalid_request"),
        ({"filename": "notes\x00.txt"}, 400, "invalid_request"),
        ({"filename": "notes\n.txt"}, 400, "invalid_request"),
        ({"filename": "invoice\u202efdp.txt"}, 400, "invalid_request"),
        ({"method": "POST"}, 405, "method_not_allowed"),
    ],
)
def test_upload_file_maps_errors_to_codes_and_statuses(request_kwargs, status_code, code):
    block = make_shortanswer_block()

    with patch("ai_eval.upload_mixin.set_custom_attribute") as set_custom_attribute:
        response = block.upload_file(upload_request(**request_kwargs))

    assert response.status_code == status_code
    assert response.json["code"] == code
    assert response.json["error"]
    set_custom_attribute.assert_any_call("ai_eval_upload_rejected", code)
    assert not LearnerUpload.objects.exists()


@pytest.mark.django_db
def test_upload_file_purges_abandoned_pending_uploads():
    block = make_shortanswer_block(max_file_uploads=1)
    with time_machine.travel(timezone.now() - timedelta(hours=25)):
        abandoned_upload = save_block_upload(block, "shortanswer")

    response = block.upload_file(upload_request())

    assert response.status_code == 200
    assert not LearnerUpload.objects.filter(pk=abandoned_upload.pk).exists()


@pytest.mark.django_db
def test_delete_upload_frees_slot():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")
    save_block_upload(block, "shortanswer")

    result = block.delete_upload.__wrapped__(block, {"pane": "shortanswer", "upload_id": str(upload.upload_id)})

    assert result == {"remaining": 2}
    assert not LearnerUpload.objects.filter(pk=upload.pk).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("upload_owner", ["sent", "other_learner", "other_pane", "malformed_request"])
def test_delete_upload_rejects_sent_or_foreign_upload(upload_owner):
    block = make_coach_block()
    if upload_owner == "sent":
        upload_id = save_sent_block_upload(block, "workspace")["upload_id"]
    elif upload_owner == "other_learner":
        upload_id = str(save_block_upload(block, "workspace", user_id=LEARNER_USER_ID + 1).upload_id)
    elif upload_owner == "other_pane":
        upload_id = str(save_block_upload(block, "coach").upload_id)
    else:
        upload_id = 42

    with pytest.raises(JsonHandlerError) as error:
        block.delete_upload.__wrapped__(block, {"pane": "workspace", "upload_id": upload_id})

    assert error.value.status_code == 400
    assert error.value.message == "Invalid upload."
    assert error.value.get_response().json["code"] == "invalid_upload"
    assert LearnerUpload.objects.count() == (0 if upload_owner == "malformed_request" else 1)


@pytest.mark.django_db
def test_delete_upload_allowed_when_uploads_disabled():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")
    block.allow_learner_uploads = False
    block._get_settings.return_value = {}

    block.delete_upload.__wrapped__(block, {"pane": "shortanswer", "upload_id": str(upload.upload_id)})

    assert not LearnerUpload.objects.exists()


def test_delete_upload_rejected_in_studio_preview():
    block = make_shortanswer_block(runtime=StudioPreviewRuntime())

    with pytest.raises(JsonHandlerError) as error:
        block.delete_upload.__wrapped__(block, {"pane": "shortanswer", "upload_id": "1b9e"})

    assert error.value.status_code == 403
    assert error.value.get_response().json["code"] == "uploads_disabled"


# Reset and slot counting


@pytest.mark.django_db
@pytest.mark.parametrize("block_type", ["shortanswer", "coach"])
def test_reset_deletes_pending_keeps_sent(block_type):
    if block_type == "shortanswer":
        block = make_shortanswer_block()
        pane = "shortanswer"
        sent_attachment = save_sent_block_upload(block, pane)
        block.sessions = [[shortanswer_message_with_attachments([sent_attachment])]]
        reset_handler = block.reset
    else:
        block = make_coach_block()
        pane = "workspace"
        sent_attachment = save_sent_block_upload(block, pane)
        block.sessions = [{"workspace_history": [coach_fragment_with_attachments(0, [sent_attachment])]}]
        reset_handler = block.reset_all
    save_block_upload(block, pane)

    result = reset_handler.__wrapped__(block, {})

    assert result["remaining"][pane] == 3
    assert pending_upload_count(block) == 0
    assert str(LearnerUpload.objects.get().upload_id) == sent_attachment["upload_id"]


@pytest.mark.django_db
def test_reset_all_on_empty_session_clears_pending():
    """``reset_all`` resets an empty session in place, so only the deleted pending uploads free its slots."""
    block = make_coach_block()
    save_block_upload(block, "workspace")
    save_block_upload(block, "coach")
    assert block._remaining_uploads("workspace") == 2

    result = block.reset_all.__wrapped__(block, {})

    assert len(block.sessions) == 1
    assert result["remaining"] == {"workspace": 3, "coach": 3}
    assert pending_upload_count(block) == 0


@pytest.mark.django_db
def test_slot_count_fresh_after_reset():
    block = make_shortanswer_block()
    sent_attachments = [save_sent_block_upload(block, "shortanswer") for _ in range(2)]
    block.sessions = [[shortanswer_message_with_attachments(sent_attachments)]]
    assert block._remaining_uploads("shortanswer") == 1

    block.reset.__wrapped__(block, {})

    assert block._remaining_uploads("shortanswer") == 3
    assert LearnerUpload.objects.filter(state=LearnerUpload.State.SENT).count() == 2


@pytest.mark.django_db
def test_coach_panes_count_slots_separately():
    block = make_coach_block()
    block.sessions = [{
        "workspace_history": [coach_fragment_with_attachments(0, [save_sent_block_upload(block, "workspace")])],
    }]
    save_block_upload(block, "workspace")
    save_block_upload(block, "coach")

    assert block._uploads_used("workspace") == 2
    assert block._uploads_used("coach") == 1


@pytest.mark.django_db
def test_old_session_without_attachments_loads():
    shortanswer_block = make_shortanswer_block(sessions=[[{"source": "user", "content": "hi"}]])
    old_coach_session = {
        "workspace_history": [{"character_index": 0, "user_message": "hi", "character_message": "hello"}],
        "final_submission": "hi",
    }
    coach_block = make_coach_block(sessions=[old_coach_session])

    assert shortanswer_block._uploads_used("shortanswer") == 0
    assert coach_block._uploads_used("workspace") == 0
    assert coach_block._get_active_session()["final_submission_attachments"] == []


# Studio


def test_studio_validation_rejects_max_above_ceiling():
    block = make_coach_block(workspace_max_file_uploads=6, coach_max_file_uploads=0)

    validation_errors, _warnings = block._collect_studio_validation_issues(block)

    assert validation_errors["workspace_max_file_uploads"] == ["Max File Uploads must be an integer between 1 and 5."]
    assert validation_errors["coach_max_file_uploads"] == ["Max File Uploads must be an integer between 1 and 5."]


def test_studio_validation_skips_hidden_upload_fields():
    """The max field is hidden while its toggle is off, and every upload field is hidden while the site switch is."""
    toggle_off_block = make_shortanswer_block(allow_learner_uploads=False, max_file_uploads=0)
    site_off_block = make_shortanswer_block(settings={}, model="ollama/llama2", max_file_uploads=0)

    toggle_off_errors, _warnings = toggle_off_block._collect_studio_validation_issues(toggle_off_block)
    site_off_errors, _warnings = site_off_block._collect_studio_validation_issues(site_off_block)

    assert "max_file_uploads" not in toggle_off_errors
    assert "max_file_uploads" not in site_off_errors
    assert "allow_learner_uploads" not in site_off_errors


def test_studio_validation_rejects_uploads_on_incapable_model():
    block = make_shortanswer_block(model="ollama/llama2")

    validation_errors, _warnings = block._collect_studio_validation_issues(block)

    assert validation_errors["allow_learner_uploads"] == [
        "The selected model can't read files. Choose another model or turn off File Upload."
    ]


def test_studio_meta_reports_upload_switch_and_ceiling():
    shortanswer_meta = make_shortanswer_block(
        settings={**UPLOADS_ON, "MAX_FILE_UPLOADS_LIMIT": 4},
    )._studio_payload_meta()
    coach_meta = make_coach_block(settings={})._studio_payload_meta()

    assert shortanswer_meta["learner_uploads_enabled"] is True
    assert shortanswer_meta["max_file_uploads_ceiling"] == 4
    assert coach_meta["learner_uploads_enabled"] is False
    assert coach_meta["max_file_uploads_ceiling"] == 5


@pytest.mark.parametrize("raw_ceiling", ["abc", 0, -2])
def test_ceiling_setting_invalid_value_ignored(raw_ceiling, caplog):
    block = make_shortanswer_block(settings={"MAX_FILE_UPLOADS_LIMIT": raw_ceiling})

    with caplog.at_level(logging.WARNING, logger="ai_eval.base"):
        assert block._max_uploads_ceiling() == 5
    assert "MAX_FILE_UPLOADS_LIMIT" in caplog.text
