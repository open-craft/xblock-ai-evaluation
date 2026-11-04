"""Tests for sending learner files with messages: handlers, prompts, rendering and the PDF transcript."""
# pylint: disable=protected-access

import base64
import logging
import uuid
from unittest.mock import Mock, patch

import pytest
from xblock.exceptions import JsonHandlerError

from ai_eval import CoachAIEvalXBlock, ShortAnswerAIEvalXBlock, upload_storage
from ai_eval.llm_services import CustomLLMService
from ai_eval.models import LearnerUpload
from ai_eval.supported_models import SupportedModels
from ai_eval.tests.test_upload_mixin import (
    attachment_entry,
    coach_fragment_with_attachments,
    make_coach_block,
    make_shortanswer_block,
    save_block_upload,
    save_sent_block_upload,
    shortanswer_message_with_attachments,
)
from ai_eval.tests.test_upload_storage import make_pdf_bytes
from ai_eval.tests.xblock_fakes import LEARNER_USER_ID, learner_scope_ids
from ai_eval.upload_mixin import LEARNER_CONTENT_FRAMING

NOTES_PART = {
    "type": "text",
    "text": '<attachment source="learner"><filename>notes.txt</filename><contents>my notes</contents></attachment>',
}


def send_shortanswer_message(block, user_input="", upload_ids=(), llm_response="feedback"):
    """Call ``get_response`` with a mocked LLM. Returns the handler result and the messages sent to the LLM."""
    with patch.object(ShortAnswerAIEvalXBlock, "get_llm_response", return_value=llm_response) as get_llm_response:
        result = block.get_response.__wrapped__(block, {"user_input": user_input, "upload_ids": list(upload_ids)})
    return result, get_llm_response.call_args.args[0]


def send_coach_message(block, character_index, user_input="", upload_ids=()):
    """Call ``get_character_response`` with a mocked LLM. Returns the handler result and the messages sent to it."""
    request = {"character_index": character_index, "user_input": user_input, "upload_ids": list(upload_ids)}
    with patch.object(CoachAIEvalXBlock, "get_llm_response", return_value="reply") as get_llm_response:
        result = block.get_character_response.__wrapped__(block, request)
    return result, get_llm_response.call_args.args[0]


def request_evaluation(block):
    """Call ``get_evaluator_response`` with a mocked LLM. Returns the handler result and the messages sent to it."""
    with patch.object(CoachAIEvalXBlock, "get_llm_response", return_value="# Evaluation Report") as get_llm_response, \
            patch.object(CoachAIEvalXBlock, "_render_final_report", return_value="<article>report</article>"):
        result = block.get_evaluator_response.__wrapped__(block, {})
    return result, get_llm_response.call_args.args[0]


def system_prompt(llm_messages):
    return llm_messages[0]["content"]


def files_message_text(llm_messages):
    """Return the text parts of the message that sends the learner's files."""
    return [part["text"] for part in llm_messages[1]["content"] if part["type"] == "text"]


def upload_state(upload):
    return LearnerUpload.objects.get(pk=upload.pk).state


# Short Answer messages


@pytest.mark.django_db
def test_get_response_accepts_file_only_message():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")

    result, _llm_messages = send_shortanswer_message(block, upload_ids=[str(upload.upload_id)])

    assert result == {"response": "feedback"}
    user_message = block.sessions[-1][0]
    assert user_message["content"] == ""
    assert user_message["attachments"] == [attachment_entry(upload)]


@pytest.mark.parametrize("user_input", ["", "   "])
def test_get_response_rejects_empty_message_without_files(user_input):
    block = make_shortanswer_block()

    with patch.object(ShortAnswerAIEvalXBlock, "get_llm_response") as get_llm_response, \
            pytest.raises(JsonHandlerError) as error:
        block.get_response.__wrapped__(block, {"user_input": user_input, "upload_ids": []})

    assert error.value.status_code == 400
    assert error.value.message == "Your message is empty."
    get_llm_response.assert_not_called()


def test_get_response_enforces_max_responses_server_side():
    block = make_shortanswer_block(max_responses=1, sessions=[[
        {"source": "user", "content": "first"},
        {"source": "llm", "content": "feedback"},
    ]])

    with patch.object(ShortAnswerAIEvalXBlock, "get_llm_response") as get_llm_response, \
            pytest.raises(JsonHandlerError) as error:
        block.get_response.__wrapped__(block, {"user_input": "second"})

    assert error.value.status_code == 403
    assert error.value.message == "No responses remaining."
    get_llm_response.assert_not_called()


@pytest.mark.django_db
def test_get_response_rejects_files_another_request_is_sending():
    """A second send of the same files during the first one's LLM call is rejected, so the files are sent once."""
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")
    request = {"user_input": "see attached", "upload_ids": [str(upload.upload_id)]}
    second_send_errors = []

    def answer_after_second_send(_messages, tag=None):  # pylint: disable=unused-argument
        with pytest.raises(JsonHandlerError) as error:
            block.get_response.__wrapped__(block, request)
        second_send_errors.append(error.value.get_response().json["code"])
        return "feedback"

    with patch.object(
        ShortAnswerAIEvalXBlock, "get_llm_response", side_effect=answer_after_second_send,
    ) as get_llm_response:
        block.get_response.__wrapped__(block, request)

    assert second_send_errors == ["invalid_upload"]
    get_llm_response.assert_called_once()
    assert upload_state(upload) == LearnerUpload.State.SENT
    assert len(block.sessions[-1]) == 2


@pytest.mark.django_db
def test_get_response_empty_llm_response_keeps_uploads_pending():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")

    with pytest.raises(JsonHandlerError) as error:
        send_shortanswer_message(block, "see attached", [str(upload.upload_id)], llm_response="")

    assert error.value.message == "A probem occurred. The LLM sent an empty response."
    assert upload_state(upload) == LearnerUpload.State.PENDING


@pytest.mark.django_db
def test_get_response_failed_llm_keeps_uploads_pending_for_retry():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")
    request = {"user_input": "see attached", "upload_ids": [str(upload.upload_id)]}

    with patch.object(ShortAnswerAIEvalXBlock, "get_llm_response", side_effect=Exception("provider down")), \
            pytest.raises(JsonHandlerError) as error:
        block.get_response.__wrapped__(block, request)

    assert error.value.status_code == 500
    assert upload_state(upload) == LearnerUpload.State.PENDING
    assert block.sessions == [[]]

    result, _llm_messages = send_shortanswer_message(block, "see attached", [str(upload.upload_id)])

    assert result["response"] == "feedback"
    assert upload_state(upload) == LearnerUpload.State.SENT


@pytest.mark.django_db
@pytest.mark.parametrize("upload_owner", ["other_block", "other_pane", "other_learner", "already_sent", "not_a_string"])
def test_get_response_rejects_upload_from_other_pane_or_block(upload_owner):
    block = make_shortanswer_block()
    if upload_owner == "other_block":
        other_block = make_shortanswer_block(scope_ids=learner_scope_ids("shortanswer", "second"))
        upload_id = str(save_block_upload(other_block, "shortanswer").upload_id)
    elif upload_owner == "other_pane":
        upload_id = str(save_block_upload(block, "workspace").upload_id)
    elif upload_owner == "other_learner":
        upload_id = str(save_block_upload(block, "shortanswer", user_id=LEARNER_USER_ID + 1).upload_id)
    elif upload_owner == "already_sent":
        upload_id = save_sent_block_upload(block, "shortanswer")["upload_id"]
    else:
        upload_id = 42

    with patch.object(ShortAnswerAIEvalXBlock, "get_llm_response") as get_llm_response, \
            pytest.raises(JsonHandlerError) as error:
        block.get_response.__wrapped__(block, {"user_input": "see attached", "upload_ids": [upload_id]})

    assert error.value.status_code == 400
    assert error.value.message == "Invalid upload."
    assert error.value.get_response().json["code"] == "invalid_upload"
    get_llm_response.assert_not_called()


@pytest.mark.django_db
def test_get_response_rejects_files_when_uploads_unavailable():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")
    block.allow_learner_uploads = False

    with pytest.raises(JsonHandlerError) as error:
        block.get_response.__wrapped__(block, {"user_input": "", "upload_ids": [str(upload.upload_id)]})

    assert error.value.status_code == 403
    assert error.value.get_response().json["code"] == "uploads_disabled"
    assert upload_state(upload) == LearnerUpload.State.PENDING


@pytest.mark.django_db
def test_get_response_rejects_more_files_than_the_limit_allows():
    """Parallel uploads can create more pending files than the limit, so sending checks the limit again."""
    block = make_shortanswer_block()
    sent_attachments = [save_sent_block_upload(block, "shortanswer") for _ in range(2)]
    block.sessions = [[shortanswer_message_with_attachments(sent_attachments), {"source": "llm", "content": "ok"}]]
    upload_ids = [str(save_block_upload(block, "shortanswer").upload_id) for _ in range(2)]

    with pytest.raises(JsonHandlerError) as error:
        block.get_response.__wrapped__(block, {"user_input": "", "upload_ids": upload_ids})

    assert error.value.status_code == 409
    assert error.value.get_response().json == {
        "code": "too_many_files",
        "error": "You've reached your file upload limit for this conversation.",
    }


@pytest.mark.django_db
def test_get_response_checks_the_limit_before_looking_up_upload_ids():
    """More IDs than the learner could send are rejected without a database lookup of each one."""
    block = make_shortanswer_block()
    upload_ids = [str(uuid.uuid4()) for _ in range(1000)]

    with patch("ai_eval.upload_storage.get_owned_uploads") as get_owned_uploads, \
            pytest.raises(JsonHandlerError) as error:
        block.get_response.__wrapped__(block, {"user_input": "", "upload_ids": upload_ids})

    assert error.value.get_response().json["code"] == "too_many_files"
    get_owned_uploads.assert_not_called()


@pytest.mark.django_db
def test_shortanswer_message_content_parts_pdf_and_text():
    block = make_shortanswer_block()
    pdf_bytes = make_pdf_bytes()
    pdf_upload = save_block_upload(
        block, "shortanswer", filename="report.pdf", file_bytes=pdf_bytes, content_type="application/pdf",
    )
    text_upload = save_block_upload(block, "shortanswer")

    _result, llm_messages = send_shortanswer_message(
        block, "see both", [str(pdf_upload.upload_id), str(text_upload.upload_id)],
    )

    assert llm_messages[-1] == {"role": "user", "content": [
        {"type": "text", "text": "see both"},
        {"type": "file", "file": {
            "file_data": f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode('ascii')}",
            "filename": "report.pdf",
        }},
        NOTES_PART,
    ]}


@pytest.mark.django_db
def test_shortanswer_earlier_files_resent_every_turn():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")
    send_shortanswer_message(block, "see attached", [str(upload.upload_id)])

    _result, llm_messages = send_shortanswer_message(block, "and one more thing")

    assert llm_messages[1] == {"role": "user", "content": [{"type": "text", "text": "see attached"}, NOTES_PART]}
    assert llm_messages[-1] == {"role": "user", "content": "and one more thing"}


@pytest.mark.django_db
def test_shortanswer_empty_text_with_files_uses_dot():
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")

    _result, llm_messages = send_shortanswer_message(block, "", [str(upload.upload_id)])

    assert llm_messages[-1]["content"][0] == {"type": "text", "text": "."}


# Coaching messages and evaluator


@pytest.mark.django_db
def test_coach_pane_accepts_file_only_rejects_empty():
    block = make_coach_block()
    upload = save_block_upload(block, "coach")

    with pytest.raises(JsonHandlerError) as error:
        send_coach_message(block, 1)
    send_coach_message(block, 1, upload_ids=[str(upload.upload_id)])

    assert error.value.status_code == 400
    assert error.value.message == "Your message is empty."
    coach_fragment = block._get_active_session()["coach_history"][0]
    assert coach_fragment["user_message"] == ""
    assert coach_fragment["attachments"] == [attachment_entry(upload)]
    assert upload_state(upload) == LearnerUpload.State.SENT


@pytest.mark.django_db
def test_workspace_file_only_message_consumes_attempt():
    block = make_coach_block()
    upload = save_block_upload(block, "workspace")

    result, _llm_messages = send_coach_message(block, 0, upload_ids=[str(upload.upload_id)])

    assert result["attempts"]["attempts_used"] == 1


@pytest.mark.django_db
def test_rejected_workspace_files_do_not_consume_attempt():
    block = make_coach_block(workspace_allow_learner_uploads=False)
    upload = save_block_upload(block, "workspace")

    with pytest.raises(JsonHandlerError) as error:
        send_coach_message(block, 0, upload_ids=[str(upload.upload_id)])

    assert error.value.status_code == 403
    assert block._get_active_session()["attempts_used"] == 0


@pytest.mark.django_db
def test_workspace_files_stay_pending_when_no_attempts_remain():
    block = make_coach_block(max_attempts=1)
    block._get_active_session()["attempts_used"] = 1
    upload = save_block_upload(block, "workspace")

    with pytest.raises(JsonHandlerError) as error:
        send_coach_message(block, 0, upload_ids=[str(upload.upload_id)])

    assert error.value.message == "No attempts remaining."
    assert upload_state(upload) == LearnerUpload.State.PENDING


@pytest.mark.django_db
def test_coach_files_stay_pending_when_llm_fails():
    block = make_coach_block()
    upload = save_block_upload(block, "coach")
    request = {"character_index": 1, "user_input": "", "upload_ids": [str(upload.upload_id)]}

    with patch.object(CoachAIEvalXBlock, "get_llm_response", side_effect=Exception("provider down")), \
            pytest.raises(Exception, match="provider down"):
        block.get_character_response.__wrapped__(block, request)

    assert upload_state(upload) == LearnerUpload.State.PENDING
    assert block._get_active_session()["coach_history"] == []


def coach_block_with_files_in_both_panes():
    """Return a Coaching block whose workspace has ``essay.txt`` and whose coach chat has ``question.txt``."""
    block = make_coach_block()
    block.sessions = [{
        "workspace_history": [coach_fragment_with_attachments(0, [
            save_sent_block_upload(block, "workspace", filename="essay.txt"),
        ])],
        "coach_history": [coach_fragment_with_attachments(1, [
            save_sent_block_upload(block, "coach", filename="question.txt"),
        ])],
    }]
    return block


@pytest.mark.django_db
def test_main_character_gets_workspace_files_only():
    block = coach_block_with_files_in_both_panes()

    _result, llm_messages = send_coach_message(block, 0, "next answer")

    assert files_message_text(llm_messages)[:2] == ["Files the learner attached, in order:", "essay.txt (message 1)"]
    assert "question.txt" not in str(llm_messages)


@pytest.mark.django_db
def test_coach_gets_coach_files_only():
    block = coach_block_with_files_in_both_panes()

    _result, llm_messages = send_coach_message(block, 1, "next question")

    assert files_message_text(llm_messages)[:2] == ["Files the learner attached, in order:", "question.txt (message 1)"]
    assert "essay.txt" not in str(llm_messages)


@pytest.mark.django_db
def test_coaching_files_numbered_by_learner_message():
    block = make_coach_block(initial_message="Hello, what is your answer?")
    block.sessions = [{"workspace_history": [
        {"character_index": 0, "user_message": "first", "character_message": "reply"},
        coach_fragment_with_attachments(0, [save_sent_block_upload(block, "workspace", filename="essay.txt")]),
    ]}]
    upload = save_block_upload(block, "workspace", filename="sources.txt")

    _result, llm_messages = send_coach_message(block, 0, "final", [str(upload.upload_id)])

    labels = [text for text in files_message_text(llm_messages) if "(message" in text]
    assert labels == ["essay.txt (message 2)", "sources.txt (message 3)"]


@pytest.mark.django_db
def test_coaching_files_message_replaces_claude_dummy():
    block = make_coach_block(model=SupportedModels.CLAUDE_SONNET.value)

    _result, messages_without_files = send_coach_message(block, 1, "hello")
    upload = save_block_upload(block, "coach")
    _result, messages_with_files = send_coach_message(block, 1, "", [str(upload.upload_id)])

    assert messages_without_files[1:] == [{"role": "user", "content": "."}]
    assert len(messages_with_files) == 2
    assert files_message_text(messages_with_files) == [
        "Files the learner attached, in order:", "notes.txt (message 2)", NOTES_PART["text"],
    ]


@pytest.mark.django_db
def test_coaching_attached_marker_rendered_with_custom_conversation_format():
    block = make_coach_block(conversation_format="{% for message in messages %}[{{ message.content }}]{% endfor %}")
    block.sessions = [{"workspace_history": [
        coach_fragment_with_attachments(0, [save_sent_block_upload(block, "workspace")]),
    ]}]
    upload = save_block_upload(block, "workspace", filename="data.csv")

    _result, llm_messages = send_coach_message(block, 0, "", [str(upload.upload_id)])

    assert "[see attached\n[Attached: notes.txt]][thanks][[Attached: data.csv]]" in system_prompt(llm_messages)


@pytest.mark.django_db
def test_attached_marker_not_in_ui_history():
    block = make_coach_block()
    attachment = save_sent_block_upload(block, "workspace")
    block.sessions = [{"workspace_history": [coach_fragment_with_attachments(0, [attachment])]}]

    workspace_history, _coach_history = block._get_chat_histories()

    assert workspace_history[0]["content"] == "see attached"
    assert workspace_history[0]["attachments"] == [attachment]


@pytest.mark.django_db
def test_evaluator_gets_latest_batch_and_latest_text():
    block = make_coach_block()
    block.sessions = [{"workspace_history": [
        coach_fragment_with_attachments(0, [save_sent_block_upload(block, "workspace", filename="draft.txt")]),
        coach_fragment_with_attachments(0, [save_sent_block_upload(block, "workspace", filename="final.txt")]),
        {"character_index": 0, "user_message": "my final answer", "character_message": "thanks"},
    ]}]

    _result, llm_messages = request_evaluation(block)

    assert "my final answer\n[Attached: final.txt]" in system_prompt(llm_messages)
    assert "draft.txt" not in str(llm_messages)
    assert files_message_text(llm_messages)[:2] == ["Files the learner attached, in order:", "final.txt (message 1)"]


@pytest.mark.django_db
def test_evaluator_accepts_file_only_history():
    block = make_coach_block()
    attachment = save_sent_block_upload(block, "workspace")
    file_only_fragment = {**coach_fragment_with_attachments(0, [attachment]), "user_message": ""}
    block.sessions = [{"workspace_history": [file_only_fragment]}]

    result, llm_messages = request_evaluation(block)

    assert result["final_submission"] == ""
    assert result["final_submission_attachments"] == [attachment]
    assert "[Attached: notes.txt]" in system_prompt(llm_messages)


def test_evaluator_rejects_history_without_text_or_files():
    block = make_coach_block()
    block.sessions = [{"workspace_history": [{"character_index": 0, "user_message": " ", "character_message": "?"}]}]

    with pytest.raises(JsonHandlerError) as error:
        request_evaluation(block)

    assert error.value.status_code == 400


@pytest.mark.django_db
def test_evaluation_discards_unsent_files_in_both_panes():
    block = make_coach_block()
    sent_attachment = save_sent_block_upload(block, "workspace")
    block.sessions = [{"workspace_history": [coach_fragment_with_attachments(0, [sent_attachment])]}]
    unsent_workspace_upload = save_block_upload(block, "workspace", filename="late.txt")
    unsent_coach_upload = save_block_upload(block, "coach", filename="question.txt")

    result, llm_messages = request_evaluation(block)

    assert result["final_submission_attachments"] == [sent_attachment]
    assert "late.txt" not in str(llm_messages)
    assert not LearnerUpload.objects.filter(pk__in=[unsent_workspace_upload.pk, unsent_coach_upload.pk]).exists()
    assert LearnerUpload.objects.get(upload_id=sent_attachment["upload_id"]).state == LearnerUpload.State.SENT


@pytest.mark.django_db
def test_failed_evaluation_keeps_unsent_files():
    block = make_coach_block()
    block.sessions = [{"workspace_history": [
        {"character_index": 0, "user_message": "my answer", "character_message": "thanks"},
    ]}]
    unsent_upload = save_block_upload(block, "workspace")

    with patch.object(CoachAIEvalXBlock, "get_llm_response", side_effect=JsonHandlerError(500, "provider down")), \
            pytest.raises(JsonHandlerError):
        block.get_evaluator_response.__wrapped__(block, {})

    assert upload_state(unsent_upload) == LearnerUpload.State.PENDING


@pytest.mark.django_db
def test_final_submission_attachments_stored():
    block = make_coach_block()
    attachment = save_sent_block_upload(block, "workspace")
    block.sessions = [{"workspace_history": [coach_fragment_with_attachments(0, [attachment])]}]

    result, _llm_messages = request_evaluation(block)

    assert result["final_submission_attachments"] == [attachment]
    assert block._get_active_session()["final_submission_attachments"] == [attachment]
    with patch.object(CoachAIEvalXBlock, "_render_final_report", return_value="<article>report</article>"):
        assert block._build_final_report_payload()["final_submission_attachments"] == [attachment]


# Mid-session gating and prompts


@pytest.mark.django_db
def test_author_toggle_off_still_sends_existing_files():
    block = make_shortanswer_block(allow_learner_uploads=False)
    block.sessions = [[
        shortanswer_message_with_attachments([save_sent_block_upload(block, "shortanswer")]),
        {"source": "llm", "content": "feedback"},
    ]]

    _result, llm_messages = send_shortanswer_message(block, "thanks")

    assert llm_messages[1]["content"] == [{"type": "text", "text": "see attached"}, NOTES_PART]


@pytest.mark.django_db
def test_site_switch_off_replaces_existing_files_with_note(caplog):
    block = make_shortanswer_block(settings={})
    block.sessions = [[
        shortanswer_message_with_attachments([save_sent_block_upload(block, "shortanswer")]),
        {"source": "llm", "content": "feedback"},
        shortanswer_message_with_attachments([save_sent_block_upload(block, "shortanswer")]),
        {"source": "llm", "content": "feedback"},
    ]]

    with caplog.at_level(logging.WARNING, logger="ai_eval.upload_mixin"):
        _result, llm_messages = send_shortanswer_message(block, "thanks")

    assert llm_messages[1]["content"][1] == {"type": "text", "text": "[notes.txt: file not available to this model]"}
    # One warning per LLM call, not one per message.
    assert caplog.text.count("Replacing 2 learner files with a note") == 1
    assert "notes.txt" not in caplog.text


@pytest.mark.django_db
def test_missing_upload_bytes_replaced_with_note(caplog):
    block = make_shortanswer_block()
    upload = save_block_upload(block, "shortanswer")
    upload_storage.get_upload_storage().delete(upload.storage_path)

    with caplog.at_level(logging.WARNING, logger="ai_eval.upload_mixin"):
        _result, llm_messages = send_shortanswer_message(block, "", [str(upload.upload_id)])

    assert llm_messages[-1]["content"][1] == {"type": "text", "text": "[notes.txt: file not available to this model]"}
    assert "is missing from storage" in caplog.text


@pytest.mark.django_db
def test_learner_framing_added_when_learner_content_present():
    shortanswer_block = make_shortanswer_block()
    coach_block = make_coach_block()

    _result, shortanswer_messages = send_shortanswer_message(shortanswer_block, "my answer")
    _result, workspace_messages = send_coach_message(coach_block, 0, "my answer")
    _result, coach_messages = send_coach_message(coach_block, 1, "my question")
    _result, evaluator_messages = request_evaluation(coach_block)

    for llm_messages in (shortanswer_messages, workspace_messages, coach_messages, evaluator_messages):
        assert LEARNER_CONTENT_FRAMING in system_prompt(llm_messages)


def test_author_attachments_render_source_author():
    block = make_shortanswer_block()
    block._download_attachment = Mock(return_value="rubric <&>")

    attachments_xml, _hash_inputs = block._render_attachments_xml(["http://example.com/rubric.txt"])

    assert attachments_xml == (
        '<attachment source="author"><filename>rubric.txt</filename>'
        "<contents>rubric &lt;&amp;&gt;</contents></attachment>"
    )


def test_custom_llm_service_flattens_content_parts():
    """Earlier files reach the custom service as text notes inside content parts, which it flattens to text."""
    service = CustomLLMService("https://models", "https://completions", "https://token", "client", "secret")
    service._get_headers = Mock(return_value={})
    completion_response = Mock(**{"json.return_value": {"response": "feedback"}})
    messages = [{"role": "user", "content": [
        {"type": "text", "text": "see attached"},
        {"type": "text", "text": "[notes.txt: file not available to this model]"},
    ]}]

    with patch("ai_eval.llm_services.requests.post", return_value=completion_response) as post:
        service.get_response("model", "", messages, None)

    assert post.call_args.kwargs["json"]["prompt"] == (
        "User: see attached [notes.txt: file not available to this model]"
    )


# Rendering and compatibility


def test_file_only_fragment_renders_user_bubble():
    block = make_coach_block()
    attachment = {"upload_id": "1b9e", "filename": "notes.txt", "content_type": "text/plain"}
    file_only_fragment = {**coach_fragment_with_attachments(0, [attachment]), "user_message": ""}

    user_bubble, character_bubble = block._get_chat_fragment_messages(file_only_fragment)

    assert user_bubble["is_user"] is True
    assert user_bubble["content"] == ""
    assert user_bubble["attachments"] == [attachment]
    assert character_bubble["content"] == "thanks"


def test_is_evaluation_fragment_ignores_file_only_message():
    block = make_coach_block()
    attachment = {"upload_id": "1b9e", "filename": "notes.txt", "content_type": "text/plain"}
    file_only_fragment = {**coach_fragment_with_attachments(0, [attachment]), "user_message": ""}
    block.sessions = [{"workspace_history": [file_only_fragment], "final_evaluation_markdown": "# Evaluation Report"}]

    assert block._is_evaluation_fragment(file_only_fragment) is False


# PDF transcript


def rendered_transcript_html(block):
    """Return the transcript HTML that ``download_pdf`` renders, without building the PDF."""
    with patch("ai_eval.base.get_site_configuration_value", return_value=""), \
            patch("ai_eval.base.get_pdf_location_nav", return_value=None), \
            patch("ai_eval.pdf_generator.HTML") as html_to_pdf:
        html_to_pdf.return_value.write_pdf.return_value = b"%PDF-"
        block.download_pdf(None)
    return html_to_pdf.call_args.kwargs["string"]
