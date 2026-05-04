"""
Testing module.
"""
# pylint: disable=redefined-outer-name,protected-access

import io
import json
import urllib.request
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from xblock.exceptions import JsonHandlerError
from xblock.field_data import DictFieldData
from xblock.test.toy_runtime import ToyRuntime

from ai_eval import (
    CodingAIEvalXBlock,
    CoachAIEvalXBlock,
    ShortAnswerAIEvalXBlock,
)
from ai_eval.base import AIEvalXBlock
from ai_eval.supported_models import SupportedModels
from ai_eval.llm_services import CustomLLMService
from ai_eval.backends.factory import BackendFactory
from ai_eval.backends.judge0 import Judge0Backend
from ai_eval.backends.custom import CustomServiceBackend
from ai_eval.utils import DEFAULT_HTTP_TIMEOUT, SUPPORTED_LANGUAGE_MAP, LanguageLabels


def _mock_handler_url(_block, handler_name, suffix='', query='', thirdparty=False):
    """Return deterministic handler URLs for frontend payload tests."""
    del suffix, query, thirdparty
    return f"/handler/{handler_name}"


@pytest.fixture
def coding_block_data():
    """Fixture for coding block test data."""
    return {
        "display_name": "Coding with AI Evaluation",
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "test-key",
        "model_api_url": "",
        "evaluation_prompt": "Evaluate this code",
        "judge0_api_key": "judge0-key",
        "language": "Python (3.8.1)",
        "question": "ca va?",
        "sessions": [{
            "USER_RESPONSE": "print('hello')",
            "AI_EVALUATION": "Looks good",
            "CODE_EXEC_RESULT": {
                "stdout": "hello",
                "stderr": "",
            },
        }],
    }


@pytest.fixture
def shortanswer_block_data():
    """Fixture for short answer block test data."""
    return {
        "display_name": "Short answer with AI Evaluation",
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "test-key",
        "model_api_url": "",
        "evaluation_prompt": "Evaluate this answer",
        "question": "ca va?",
        "sessions": [[{"source": "user", "content": "hi"}]],
        "max_responses": 3,
        "allow_reset": False,
        "character_image": "",
        "attachment_urls": [],
        "hide_question": False,
    }


def _empty_coach_session():
    """Return the expected default Coaching session shape."""
    return {
        "workspace_history": [],
        "coach_history": [],
        "evaluation_fragments": [],
        "attempts_used": 0,
        "finished": False,
        "final_submission": "",
        "final_evaluation_markdown": "",
    }


@pytest.fixture
def coach_block_data():
    """Fixture for Coaching block test data."""
    return {
        "display_name": "Coached AI Evaluation",
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "test-key",
        "model_api_url": "",
        "character_1_name": "Patient",
        "character_1_role": "Patient",
        "character_2_name": "Coach",
        "character_2_role": "Coach",
        "scenario_data": {
            "case_details": "Case details",
            "learning_objectives": ["Objective"],
            "evaluation_criteria": [{"name": "Criterion"}],
        },
        "max_attempts": 3,
        "allow_reset": True,
        "conversation_format": "<conversation>{{ messages|length }}</conversation>",
        "message_content_tag": "content",
    }


@pytest.fixture
def ai_eval_block():
    """Fixture for basic AIEvalXBlock."""
    runtime = ToyRuntime()
    block = AIEvalXBlock(
        runtime,
        DictFieldData(
            {
                "model": SupportedModels.GPT4O.value,
                "model_api_key": "",
            }
        ),
        None,
    )
    return block


def test_coding_block_student_view(coding_block_data):
    """Test the basic view loads for CodingAIEvalXBlock."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    with patch.object(block.runtime, "handler_url", side_effect=_mock_handler_url):
        frag = block.student_view()

    monaco_html = AIEvalXBlock.loader.render_django_template(
        "/templates/monaco.html",
        {
            "monaco_language": SUPPORTED_LANGUAGE_MAP[LanguageLabels.Python].monaco_id,
        },
    )

    assert frag.js_init_fn == "CodingAIEvalXBlock"
    assert frag.json_init_args == {
        "view": "student",
        "handler_urls": {
            "submit_code_handler": "/handler/submit_code_handler",
            "get_submission_result_handler": "/handler/get_submission_result_handler",
            "get_response": "/handler/get_response",
            "reset_handler": "/handler/reset_handler",
        },
        "initial_state": {
            "code": "print('hello')",
            "ai_evaluation": "Looks good",
            "code_exec_result": {
                "stdout": "hello",
                "stderr": "",
            },
        },
        "meta": {
            "question": coding_block_data["question"],
            "language": coding_block_data["language"],
            "monaco_html": monaco_html,
        },
    }
    assert '<div data-ai-eval-react-root="true"></div>' in frag.content


def test_coding_block_studio_view(coding_block_data):
    """Coding Studio should boot the React editor payload."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            with patch.object(block.runtime, "handler_url", side_effect=_mock_handler_url):
                frag = block.studio_view()

    assert frag.js_init_fn == "CodingAIEvalXBlockStudio"
    assert '<div data-ai-eval-react-root="true"></div>' in frag.content
    assert frag.json_init_args["view"] == "studio"
    assert frag.json_init_args["handler_urls"] == {
        "studio_submit": "/handler/studio_submit",
    }
    assert frag.json_init_args["initial_state"]["question"] == coding_block_data["question"]
    assert frag.json_init_args["initial_state"]["judge0_api_key"] == coding_block_data["judge0_api_key"]
    assert frag.json_init_args["meta"]["lock_metadata"]["initial_model"] == SupportedModels.GPT4O.value
    assert "language" in frag.json_init_args["meta"]["field_metadata"]
    assert frag.json_init_args["meta"]["field_metadata"]["model"]["choices"] == [
        {
            "display_name": "— Select a model —",
            "value": "",
        },
        {
            "display_name": SupportedModels.GPT4O.value,
            "value": SupportedModels.GPT4O.value,
        },
    ]


def test_shortanswer_block_student_view(shortanswer_block_data):
    """Test the basic view loads for ShortAnswerAIEvalXBlock."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    with patch.object(block.runtime, "handler_url", side_effect=_mock_handler_url):
        frag = block.student_view()
    assert frag.js_init_fn == "ShortAnswerAIEvalXBlock"
    assert frag.json_init_args == {
        "view": "student",
        "handler_urls": {
            "get_response": "/handler/get_response",
            "reset": "/handler/reset",
        },
        "initial_state": {
            "messages": shortanswer_block_data["sessions"][-1],
        },
        "meta": {
            "question": shortanswer_block_data["question"],
            "max_responses": shortanswer_block_data["max_responses"],
            "allow_reset": shortanswer_block_data["allow_reset"],
            "character_image": shortanswer_block_data["character_image"],
            "hide_question": shortanswer_block_data["hide_question"],
        },
    }
    assert '<div data-ai-eval-react-root="true"></div>' in frag.content


def test_shortanswer_reset_allowed(shortanswer_block_data):
    """Test the reset function when allowed."""
    data = {
        **shortanswer_block_data,
        "allow_reset": True,
    }
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    # Pre-populate thread map to verify reset clears it
    block.thread_map = {"provider:model:tag": "abc123"}
    block.reset.__wrapped__(block, data={})
    assert block.sessions == [shortanswer_block_data["sessions"][0], []]
    assert not block.thread_map


def test_shortanswer_reset_forbidden(shortanswer_block_data):
    """Test the reset function when forbidden."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    with pytest.raises(JsonHandlerError):
        block.reset.__wrapped__(block, data={})
    assert block.sessions == shortanswer_block_data["sessions"]


def test_character_image(shortanswer_block_data):
    """Test the character image."""
    data = {
        **shortanswer_block_data,
        "character_image": "/static/image.jpg",
    }
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    with patch.object(block.runtime, "handler_url", side_effect=_mock_handler_url):
        frag = block.student_view()
    assert frag.json_init_args["meta"]["character_image"] == "/static/image.jpg"


def test_shortanswer_block_studio_view(shortanswer_block_data):
    """Short Answer Studio should boot the React editor payload."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            with patch.object(block.runtime, "handler_url", side_effect=_mock_handler_url):
                frag = block.studio_view()

    assert frag.js_init_fn == "ShortAnswerAIEvalXBlockStudio"
    assert '<div data-ai-eval-react-root="true"></div>' in frag.content
    assert frag.json_init_args["view"] == "studio"
    assert frag.json_init_args["handler_urls"] == {
        "studio_submit": "/handler/studio_submit",
    }
    assert frag.json_init_args["initial_state"]["question"] == shortanswer_block_data["question"]
    assert frag.json_init_args["meta"]["lock_metadata"]["initial_model"] == SupportedModels.GPT4O.value
    assert "question" in frag.json_init_args["meta"]["field_metadata"]
    assert frag.json_init_args["meta"]["field_metadata"]["model"]["choices"] == [
        {
            "display_name": "— Select a model —",
            "value": "",
        },
        {
            "display_name": SupportedModels.GPT4O.value,
            "value": SupportedModels.GPT4O.value,
        },
    ]


def test_coach_block_student_view(coach_block_data):
    """Coaching student view should boot the React learner payload."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)

    with patch.object(block.runtime, "handler_url", side_effect=_mock_handler_url):
        frag = block.student_view()

    assert frag.js_init_fn == "CoachAIEvalXBlock"
    assert frag.json_init_args == {
        "view": "student",
        "handler_urls": {
            "get_character_response": "/handler/get_character_response",
            "get_evaluator_response": "/handler/get_evaluator_response",
            "reset_all": "/handler/reset_all",
        },
        "initial_state": {
            "chat_histories": [[], []],
            "finished": False,
            "attempts": {
                "max_attempts": 3,
                "attempts_used": 0,
                "attempts_remaining": 3,
                "can_retry": True,
            },
        },
        "meta": {
            "characters": [
                {
                    "name": "Patient",
                    "role": "Patient",
                    "avatar": "",
                    "pane": "workspace",
                },
                {
                    "name": "Coach",
                    "role": "Coach",
                    "avatar": "",
                    "pane": "coach",
                },
            ],
            "initial_message": {
                "character": {
                    "name": "Patient",
                    "role": "Patient",
                    "avatar": "",
                    "pane": "workspace",
                },
                "content": "",
                "pane": "workspace",
                "is_user": False,
            },
            "coach_initial_message": {
                "character": {
                    "name": "Coach",
                    "role": "Coach",
                    "avatar": "",
                    "pane": "coach",
                },
                "content": "",
                "pane": "coach",
                "is_user": False,
            },
            "titles": {
                "workspace": "Add your answer",
                "coach": "Coach",
            },
            "allow_reset": True,
            "intro_text": "",
        },
    }
    assert '<div data-ai-eval-react-root="true"></div>' in frag.content


def test_coach_block_studio_view(coach_block_data):
    """Coaching Studio should boot the React editor payload."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            with patch.object(block.runtime, "handler_url", side_effect=_mock_handler_url):
                frag = block.studio_view()

    assert frag.js_init_fn == "CoachAIEvalXBlockStudio"
    assert '<div data-ai-eval-react-root="true"></div>' in frag.content
    assert frag.json_init_args["view"] == "studio"
    assert frag.json_init_args["handler_urls"] == {
        "studio_submit": "/handler/studio_submit",
    }
    assert frag.json_init_args["initial_state"]["scenario_data"] == coach_block_data["scenario_data"]
    assert frag.json_init_args["initial_state"]["max_attempts"] == coach_block_data["max_attempts"]
    assert frag.json_init_args["meta"]["lock_metadata"]["initial_model"] == SupportedModels.GPT4O.value
    assert "scenario_data" in frag.json_init_args["meta"]["field_metadata"]
    assert frag.json_init_args["meta"]["field_metadata"]["model"]["choices"] == [
        {
            "display_name": "— Select a model —",
            "value": "",
        },
        {
            "display_name": SupportedModels.GPT4O.value,
            "value": SupportedModels.GPT4O.value,
        },
    ]


def test_coach_block_migrates_older_state_to_sessions(coach_block_data):
    """Older Coaching learner state should migrate into sessions."""
    existing_workspace = [{
        "character_index": 0,
        "user_message": "student answer",
        "character_message": "patient reply",
    }]
    existing_coach = [{
        "character_index": 1,
        "user_message": "help",
        "character_message": "coach reply",
    }]
    existing_evaluation = [{
        "character_index": 0,
        "user_message": "",
        "character_message": "# Evaluation Report",
        "is_evaluation": True,
    }]
    data = {
        **coach_block_data,
        "workspace_history": existing_workspace,
        "coach_history": existing_coach,
        "evaluation_fragments": existing_evaluation,
        "attempts_used": 1,
        "finished": True,
        "final_submission": "student answer",
        "final_evaluation_markdown": "# Evaluation Report",
    }
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)

    expected_session = {
        "workspace_history": existing_workspace,
        "coach_history": existing_coach,
        "evaluation_fragments": existing_evaluation,
        "attempts_used": 1,
        "finished": True,
        "final_submission": "student answer",
        "final_evaluation_markdown": "# Evaluation Report",
    }

    assert block._get_active_session() == expected_session
    assert block.sessions == [expected_session]
    assert not block.workspace_history
    assert not block.coach_history
    assert not block.evaluation_fragments
    assert block.attempts_used == 0
    assert block.finished is False
    assert block.final_submission == ""
    assert block.final_evaluation_markdown == ""


@patch("ai_eval.coach.get_llm_service", return_value=Mock())
@patch.object(CoachAIEvalXBlock, "get_llm_response", return_value="patient follow-up")
def test_coach_get_character_response_uses_session_runtime_state(
    mock_get_llm,
    _mock_get_llm_service,
    coach_block_data,
):
    """Coaching runtime should write new activity only into the active session."""
    existing_fragment = {
        "character_index": 0,
        "user_message": "first answer",
        "character_message": "first reply",
    }
    data = {
        **coach_block_data,
        "workspace_history": [existing_fragment],
        "attempts_used": 1,
    }
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)

    result = block.get_character_response.__wrapped__(
        block,
        data={"character_index": 0, "user_input": "second answer"},
    )

    assert result["message"]["content"] == "patient follow-up"
    assert result["attempts"]["attempts_used"] == 2
    assert result["finished"] is False
    assert block.sessions == [{
        "workspace_history": [
            existing_fragment,
            {
                "character_index": 0,
                "user_message": "second answer",
                "character_message": "patient follow-up",
            },
        ],
        "coach_history": [],
        "evaluation_fragments": [],
        "attempts_used": 2,
        "finished": False,
        "final_submission": "",
        "final_evaluation_markdown": "",
    }]
    assert not block.workspace_history
    mock_get_llm.assert_called_once()


@patch("ai_eval.coach.get_llm_service", return_value=Mock())
@patch.object(CoachAIEvalXBlock, "_render_final_report", return_value="<article>report</article>")
@patch.object(CoachAIEvalXBlock, "get_llm_response", return_value="# Evaluation Report")
def test_coach_get_evaluator_response_persists_active_session(
    mock_get_llm,
    mock_render_report,
    _mock_get_llm_service,
    coach_block_data,
):
    """Evaluator output should finalize the active Coaching session."""
    session = _empty_coach_session()
    session["workspace_history"] = [{
        "character_index": 0,
        "user_message": "final learner answer",
        "character_message": "patient reply",
    }]
    session["attempts_used"] = 1
    block = CoachAIEvalXBlock(
        ToyRuntime(),
        DictFieldData({**coach_block_data, "sessions": [session]}),
        None,
    )

    result = block.get_evaluator_response.__wrapped__(block, data={})

    assert result["evaluation_markdown"] == "# Evaluation Report"
    assert result["final_submission"] == "final learner answer"
    assert result["report_html"] == "<article>report</article>"
    assert result["finished"] is True
    assert block.sessions == [{
        "workspace_history": session["workspace_history"],
        "coach_history": [],
        "evaluation_fragments": [{
            "character_index": 0,
            "user_message": "",
            "character_message": "# Evaluation Report",
            "is_evaluation": True,
        }],
        "attempts_used": 1,
        "finished": True,
        "final_submission": "final learner answer",
        "final_evaluation_markdown": "# Evaluation Report",
    }]
    mock_get_llm.assert_called_once()
    mock_render_report.assert_called_once_with("final learner answer")


def test_coach_reset_all_appends_new_empty_session_for_meaningful_state(coach_block_data):
    """Reset should preserve prior Coaching history and start a new active session."""
    prior_session = {
        "workspace_history": [{
            "character_index": 0,
            "user_message": "answer",
            "character_message": "reply",
        }],
        "coach_history": [],
        "evaluation_fragments": [],
        "attempts_used": 1,
        "finished": False,
        "final_submission": "",
        "final_evaluation_markdown": "",
    }
    block = CoachAIEvalXBlock(
        ToyRuntime(),
        DictFieldData({**coach_block_data, "sessions": [prior_session]}),
        None,
    )
    block.thread_map = {
        "provider:model:hash:character0": "thread-1",
        "provider:model:hash:character1": "thread-2",
        "provider:model:hash:evaluator": "thread-3",
    }

    result = block.reset_all.__wrapped__(block, data={})

    assert result == {
        "chat_histories": [[], []],
        "attempts": {
            "max_attempts": 3,
            "attempts_used": 0,
            "attempts_remaining": 3,
            "can_retry": True,
        },
        "finished": False,
    }
    assert block.sessions == [prior_session, _empty_coach_session()]
    assert block.thread_map == {}


def test_coach_reset_all_avoids_duplicate_empty_sessions(coach_block_data):
    """Reset should reuse the existing empty active session."""
    block = CoachAIEvalXBlock(
        ToyRuntime(),
        DictFieldData({**coach_block_data, "sessions": [_empty_coach_session()]}),
        None,
    )
    block.thread_map = {"provider:model:hash:character0": "thread-1"}

    result = block.reset_all.__wrapped__(block, data={})

    assert result["chat_histories"] == [[], []]
    assert result["attempts"] == {
        "max_attempts": 3,
        "attempts_used": 0,
        "attempts_remaining": 3,
        "can_retry": True,
    }
    assert result["finished"] is False
    assert block.sessions == [_empty_coach_session()]
    assert block.thread_map == {}


def test_coach_studio_submit_success(coach_block_data):
    """Coaching React Studio saves should persist fields and return the shared response shape."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]
    scenario_data = {
        "case_details": "Updated case details",
        "learning_objectives": ["Updated objective"],
        "evaluation_criteria": [{"name": "Updated criterion"}],
    }

    payload = {
        field_name: getattr(block, field_name)
        for field_name in block.editable_fields
    }
    payload.update({
        "display_name": "Updated Coaching Title",
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "updated-key",
        "model_api_url": "",
        "initial_message": "Start here",
        "coach_initial_message": "Ask me anything",
        "scenario_data": json.dumps(scenario_data),
        "workspace_title": "Workspace",
        "coach_title": "Mentor",
        "intro_text": "<p>Updated intro</p>",
        "character_1_name": "Learner Patient",
        "character_1_role": "Patient",
        "character_1_prompt": block.character_1_prompt,
        "character_1_avatar": "/static/patient.png",
        "character_2_name": "Support Coach",
        "character_2_role": "Coach",
        "character_2_prompt": block.character_2_prompt,
        "character_2_avatar": "/static/coach.png",
        "evaluator_prompt": block.evaluator_prompt,
        "blacklist": json.dumps(["AI assistant", "forbidden phrase"]),
        "max_attempts": "4",
        "allow_reset": False,
    })

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(block, payload)

    assert response["success"] is True
    assert response["validation_errors"] == {}
    assert response["validation_warnings"] == []
    assert block.display_name == "Updated Coaching Title"
    assert block.initial_message == "Start here"
    assert block.coach_initial_message == "Ask me anything"
    assert block.scenario_data == scenario_data
    assert block.workspace_title == "Workspace"
    assert block.coach_title == "Mentor"
    assert block.character_1_avatar == "/static/patient.png"
    assert block.character_2_avatar == "/static/coach.png"
    assert block.blacklist == ["AI assistant", "forbidden phrase"]
    assert block.max_attempts == 4
    assert block.allow_reset is False


def test_coach_studio_submit_validation_errors(coach_block_data):
    """Coaching Studio should keep invalid values unsaved and return field errors."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    payload = {
        field_name: getattr(block, field_name)
        for field_name in block.editable_fields
    }
    payload.update({
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "updated-key",
        "scenario_data": "[]",
        "blacklist": "{}",
    })

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(block, payload)

    assert response["success"] is False
    assert response["validation_errors"] == {
        "scenario_data": ["Scenario data must be a JSON object (dictionary)."],
        "blacklist": ["Output blacklist must be a JSON array."],
    }
    assert response["validation_warnings"] == []
    assert block.scenario_data == coach_block_data["scenario_data"]
    assert block.blacklist == ["AI assistant"]


def test_coach_studio_submit_scenario_field_validation_errors(coach_block_data):
    """Coaching Studio should map malformed scenario data to specific authoring fields."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    payload = {
        field_name: getattr(block, field_name)
        for field_name in block.editable_fields
    }
    payload.update({
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "updated-key",
        "scenario_data": json.dumps({
            "case_details": 7,
            "learning_objectives": ["Keep this one", 2],
            "evaluation_criteria": [{}, "bad"],
        }),
        "blacklist": json.dumps(block.blacklist),
    })

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(block, payload)

    assert response["success"] is False
    assert response["validation_errors"] == {
        "scenario_case_details": ["Scenario must be a valid string."],
        "scenario_learning_objectives": ["Learning objective 2 must be text."],
        "scenario_evaluation_criteria": [
            "Evaluation criterion 1 must include a name.",
            "Evaluation criterion 2 must be a valid criterion.",
        ],
    }
    assert response["validation_warnings"] == []
    assert block.scenario_data == coach_block_data["scenario_data"]


def test_coach_studio_submit_strips_empty_blacklist_entries(coach_block_data):
    """Coaching Studio should drop empty blacklist rows before persisting them."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    payload = {
        field_name: getattr(block, field_name)
        for field_name in block.editable_fields
    }
    payload.update({
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "updated-key",
        "scenario_data": json.dumps(block.scenario_data),
        "blacklist": json.dumps(["AI assistant", "", "   "]),
    })

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(block, payload)

    assert response["success"] is True
    assert response["validation_errors"] == {}
    assert block.blacklist == ["AI assistant"]


def test_coach_studio_submit_rejects_incomplete_payload(coach_block_data):
    """Coaching Studio saves should fail loudly when the frontend omits editable fields."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                },
            )

    assert response["success"] is False
    assert response["validation_errors"] == {
        "model_api_key": ["Missing field in Studio payload."],
        "model_api_url": ["Missing field in Studio payload."],
        "initial_message": ["Missing field in Studio payload."],
        "coach_initial_message": ["Missing field in Studio payload."],
        "scenario_data": ["Missing field in Studio payload."],
        "workspace_title": ["Missing field in Studio payload."],
        "coach_title": ["Missing field in Studio payload."],
        "intro_text": ["Missing field in Studio payload."],
        "character_1_name": ["Missing field in Studio payload."],
        "character_1_role": ["Missing field in Studio payload."],
        "character_1_prompt": ["Missing field in Studio payload."],
        "character_1_avatar": ["Missing field in Studio payload."],
        "character_2_name": ["Missing field in Studio payload."],
        "character_2_role": ["Missing field in Studio payload."],
        "character_2_prompt": ["Missing field in Studio payload."],
        "character_2_avatar": ["Missing field in Studio payload."],
        "evaluator_prompt": ["Missing field in Studio payload."],
        "blacklist": ["Missing field in Studio payload."],
        "max_attempts": ["Missing field in Studio payload."],
        "allow_reset": ["Missing field in Studio payload."],
    }


def test_coach_studio_submit_allows_warnings(coach_block_data):
    """Coaching Studio warnings should not block a successful save."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)

    payload = {
        field_name: getattr(block, field_name)
        for field_name in block.editable_fields
    }
    payload.update({
        "display_name": "Updated Coaching Title",
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "updated-key",
        "model_api_url": "",
        "scenario_data": json.dumps(block.scenario_data),
        "blacklist": json.dumps(block.blacklist),
        "max_attempts": "4",
        "allow_reset": True,
    })

    with patch.object(
        CoachAIEvalXBlock,
        "_collect_studio_validation_issues",
        return_value=({}, ["Non-blocking warning"]),
    ):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(block, payload)

    assert response["success"] is True
    assert response["validation_errors"] == {}
    assert response["validation_warnings"] == ["Non-blocking warning"]
    assert block.display_name == "Updated Coaching Title"


def test_coach_messages_for_character_include_blacklist_instruction(coach_block_data):
    """Character prompts should instruct the model to avoid blocked language."""
    block = CoachAIEvalXBlock(
        ToyRuntime(),
        DictFieldData({**coach_block_data, "blacklist": ["AI assistant", "out of character"]}),
        None,
    )

    messages = list(block._messages_for_character(0, "second answer"))

    assert messages[0]["role"] == "system"
    assert (
        'Do not use any of these words or phrases in your response: '
        '"AI assistant", "out of character".'
    ) in messages[0]["content"]


@patch("ai_eval.coach.get_llm_service", return_value=Mock())
@patch.object(CoachAIEvalXBlock, "_render_final_report", return_value="<article>report</article>")
def test_coach_get_evaluator_response_includes_blacklist_instruction(
    _mock_render_report,
    _mock_get_llm_service,
    coach_block_data,
):
    """Evaluator prompts should also instruct the model to avoid blocked language."""
    session = _empty_coach_session()
    session["workspace_history"] = [{
        "character_index": 0,
        "user_message": "final learner answer",
        "character_message": "patient reply",
    }]
    block = CoachAIEvalXBlock(
        ToyRuntime(),
        DictFieldData({**coach_block_data, "sessions": [session], "blacklist": ["AI assistant"]}),
        None,
    )

    captured_messages = {}

    def _capture_messages(messages, tag=None):
        captured_messages["tag"] = tag
        captured_messages["messages"] = list(messages)
        return "# Evaluation Report"

    with patch.object(CoachAIEvalXBlock, "get_llm_response", side_effect=_capture_messages):
        block.get_evaluator_response.__wrapped__(block, data={})

    assert captured_messages["messages"][0]["role"] == "system"
    assert (
        'Do not use any of these words or phrases in your response: "AI assistant".'
    ) in captured_messages["messages"][0]["content"]


@patch("ai_eval.coach.get_llm_service", return_value=Mock())
def test_coach_thread_tag_changes_when_blacklist_changes(
    _mock_get_llm_service,
    coach_block_data,
):
    """Blacklist changes should reset thread tags because they change the system prompt."""
    runtime = ToyRuntime()
    block_without_blacklist = CoachAIEvalXBlock(
        runtime,
        DictFieldData({**coach_block_data, "blacklist": []}),
        None,
    )
    block_with_blacklist = CoachAIEvalXBlock(
        runtime,
        DictFieldData({**coach_block_data, "blacklist": ["AI assistant"]}),
        None,
    )

    assert (
        block_without_blacklist._get_thread_tag("character0")
        != block_with_blacklist._get_thread_tag("character0")
    )


@patch("ai_eval.coach.get_llm_service", return_value=Mock())
@patch.object(CoachAIEvalXBlock, "get_llm_response", return_value="patient follow-up")
def test_coach_get_character_response_ignores_empty_blacklist_entries(
    mock_get_llm,
    _mock_get_llm_service,
    coach_block_data,
):
    """Empty blacklist entries should not trigger runtime response blocking."""
    block = CoachAIEvalXBlock(
        ToyRuntime(),
        DictFieldData({**coach_block_data, "blacklist": ["", "AI assistant"]}),
        None,
    )

    result = block.get_character_response.__wrapped__(
        block,
        data={"character_index": 0, "user_input": "second answer"},
    )

    assert result["message"]["content"] == "patient follow-up"
    mock_get_llm.assert_called_once()


def test_shortanswer_studio_submit_success(shortanswer_block_data):
    """React Studio saves should persist fields and return the shared response shape."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block._get_attachments = Mock(return_value=[])
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                    "model_api_key": "updated-key",
                    "model_api_url": "",
                    "question": "Updated question",
                    "evaluation_prompt": "Updated prompt",
                    "max_responses": "4",
                    "allow_reset": True,
                    "character_image": "/static/new-image.jpg",
                    "attachment_urls": ["http://example.com/1.txt"],
                    "hide_question": False,
                },
            )

    assert response["success"] is True
    assert response["validation_errors"] == {}
    assert response["validation_warnings"] == []
    assert block.display_name == "Updated title"
    assert block.question == "Updated question"
    assert block.max_responses == 4
    assert block.allow_reset is True
    assert block.character_image == "/static/new-image.jpg"
    assert block.attachment_urls == ["http://example.com/1.txt"]


def test_shortanswer_studio_submit_validation_errors(shortanswer_block_data):
    """React Studio save failures should keep values unsaved and return structured field errors."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block._get_attachments = Mock(side_effect=Exception("download failed"))
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                    "model_api_key": "updated-key",
                    "model_api_url": "",
                    "question": "",
                    "evaluation_prompt": "Updated prompt",
                    "max_responses": "0",
                    "allow_reset": True,
                    "character_image": "",
                    "attachment_urls": ["http://example.com/bad.txt"],
                    "hide_question": False,
                },
            )

    assert response["success"] is False
    assert response["validation_errors"] == {
        "question": ["Question field is mandatory"],
        "max_responses": ["max responses must be an integer between 1 and 30"],
        "attachment_urls": ["Error downloading attachments"],
    }
    assert response["validation_warnings"] == []
    assert block.question == shortanswer_block_data["question"]
    assert block.max_responses == shortanswer_block_data["max_responses"]


def test_shortanswer_studio_submit_rejects_incomplete_payload(shortanswer_block_data):
    """React Studio saves should fail loudly when the frontend omits editable fields."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                },
            )

    assert response["success"] is False
    assert response["validation_errors"] == {
        "model_api_key": ["Missing field in Studio payload."],
        "model_api_url": ["Missing field in Studio payload."],
        "question": ["Missing field in Studio payload."],
        "evaluation_prompt": ["Missing field in Studio payload."],
        "max_responses": ["Missing field in Studio payload."],
        "allow_reset": ["Missing field in Studio payload."],
        "character_image": ["Missing field in Studio payload."],
        "attachment_urls": ["Missing field in Studio payload."],
        "hide_question": ["Missing field in Studio payload."],
    }


def test_shortanswer_studio_submit_allows_warnings(shortanswer_block_data):
    """Warnings should be returned inline without blocking a successful save."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block._get_attachments = Mock(return_value=[])

    with patch.object(
        ShortAnswerAIEvalXBlock,
        "_collect_studio_validation_issues",
        return_value=({}, ["Non-blocking warning"]),
    ):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                    "model_api_key": "updated-key",
                    "model_api_url": "",
                    "question": "Updated question",
                    "evaluation_prompt": "Updated prompt",
                    "max_responses": "4",
                    "allow_reset": True,
                    "character_image": "/static/new-image.jpg",
                    "attachment_urls": ["http://example.com/1.txt"],
                    "hide_question": False,
                },
            )

    assert response["success"] is True
    assert response["validation_errors"] == {}
    assert response["validation_warnings"] == ["Non-blocking warning"]
    assert block.display_name == "Updated title"


def test_coding_studio_submit_success(coding_block_data):
    """Coding React Studio saves should persist fields and return the shared response shape."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                    "model_api_key": "updated-key",
                    "model_api_url": "",
                    "question": "Updated question",
                    "evaluation_prompt": "Updated prompt",
                    "judge0_api_key": "updated-judge0-key",
                    "language": LanguageLabels.Python,
                },
            )

    assert response["success"] is True
    assert response["validation_errors"] == {}
    assert response["validation_warnings"] == []
    assert block.display_name == "Updated title"
    assert block.question == "Updated question"
    assert block.evaluation_prompt == "Updated prompt"
    assert block.judge0_api_key == "updated-judge0-key"
    assert block.language == LanguageLabels.Python


def test_coding_studio_submit_validation_errors(coding_block_data):
    """Coding React Studio should keep invalid values unsaved and return field errors."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                    "model_api_key": "updated-key",
                    "model_api_url": "",
                    "question": "",
                    "evaluation_prompt": "Updated prompt",
                    "judge0_api_key": "",
                    "language": LanguageLabels.Python,
                },
            )

    assert response["success"] is False
    assert response["validation_errors"] == {
        "question": ["Question field is mandatory"],
        "judge0_api_key": ["Judge0 API key is mandatory"],
    }
    assert response["validation_warnings"] == []
    assert block.question == coding_block_data["question"]
    assert block.judge0_api_key == coding_block_data["judge0_api_key"]


def test_coding_studio_submit_rejects_incomplete_payload(coding_block_data):
    """Coding Studio saves should fail loudly when the frontend omits editable fields."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                },
            )

    assert response["success"] is False
    assert response["validation_errors"] == {
        "model_api_key": ["Missing field in Studio payload."],
        "model_api_url": ["Missing field in Studio payload."],
        "question": ["Missing field in Studio payload."],
        "evaluation_prompt": ["Missing field in Studio payload."],
        "judge0_api_key": ["Missing field in Studio payload."],
        "language": ["Missing field in Studio payload."],
    }


def test_coding_studio_submit_allows_warnings(coding_block_data):
    """Coding Studio warnings should not block a successful save."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)

    with patch.object(
        CodingAIEvalXBlock,
        "_collect_studio_validation_issues",
        return_value=({}, ["Non-blocking warning"]),
    ):
        with patch("ai_eval.base.get_site_configuration_value", return_value=None):
            response = block.studio_submit.__wrapped__(
                block,
                {
                    "display_name": "Updated title",
                    "model": SupportedModels.GPT4O.value,
                    "model_api_key": "updated-key",
                    "model_api_url": "",
                    "question": "Updated question",
                    "evaluation_prompt": "Updated prompt",
                    "judge0_api_key": "updated-judge0-key",
                    "language": LanguageLabels.Python,
                },
            )

    assert response["success"] is True
    assert response["validation_errors"] == {}
    assert response["validation_warnings"] == ["Non-blocking warning"]
    assert block.display_name == "Updated title"


def test_shortanswer_attachments(shortanswer_block_data):
    """Test attachments for ShortAnswerAIEvalXBlock."""
    data = {
        **shortanswer_block_data,
        "attachment_urls": [
            "http://example.com/1.txt",
            "http://example.com/2.txt",
        ],
    }
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    block._download_attachment = Mock(return_value="file contents <&>")
    with patch('ai_eval.shortanswer.get_llm_service') as mock_service, \
         patch('ai_eval.llm.get_llm_service') as mock_llm_service, \
         patch('ai_eval.base.get_site_configuration_value', return_value=None), \
         patch('ai_eval.base.get_llm_response') as mocked:
        mock_service.return_value = Mock()
        mock_service.return_value.supports_threads.return_value = False
        mock_llm_service.return_value = mock_service.return_value
        mocked.return_value = (".", None)
        block.get_response.__wrapped__(block, data={"user_input": "."})
        # Extract the messages argument passed into get_llm_response
        messages = mocked.call_args.kwargs.get('messages') or mocked.call_args.args[2]
    prompt = messages[0]["content"]
    assert "<filename>1.txt</filename>" in prompt
    assert "<contents>file contents &lt;&amp;&gt;</contents>" in prompt


def test_shortanswer_attachments_encoding(shortanswer_block_data):
    """Test attachments for ShortAnswerAIEvalXBlock."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    urllib.request.urlopen = Mock(return_value=io.BytesIO("á".encode('latin-1')))
    contents = block._download_attachment("http://example.com/1.txt")
    assert contents == "á"


def test_custom_llm_models_dict_response_parsed():
    """Custom service supports {"models": {id: {...}}} response bodies."""
    service = CustomLLMService(
        models_url="https://example.com/models",
        completions_url="https://example.com/completions",
        token_url="https://example.com/token",
        client_id="client",
        client_secret="secret",
    )
    service._get_headers = Mock(return_value={"Authorization": "Bearer token"})  # pylint: disable=protected-access

    mocked_response = Mock()
    mocked_response.json.return_value = {
        "models": {
            "Meta-Llama4-Maverick": {
                "name": "Meta-Llama4-Maverick",
                "display_name": "Maverick (Llama 4)",
            },
            "gpt-4o": {"display_name": "GPT-4o"},
        }
    }
    mocked_response.raise_for_status.return_value = None

    with patch("ai_eval.llm_services.requests.get", return_value=mocked_response):
        assert service.get_available_models() == ["Meta-Llama4-Maverick", "gpt-4o"]


def test_custom_llm_completion_uses_default_http_timeout():
    """Custom completion requests use the shared outbound HTTP timeout."""
    service = CustomLLMService(
        models_url="https://example.com/models",
        completions_url="https://example.com/completions",
        token_url="https://example.com/token",
        client_id="client",
        client_secret="secret",
    )
    service._get_headers = Mock(return_value={"Authorization": "Bearer token"})  # pylint: disable=protected-access

    mocked_response = Mock()
    mocked_response.json.return_value = {"response": "Feedback"}
    mocked_response.raise_for_status.return_value = None

    with patch("ai_eval.llm_services.requests.post", return_value=mocked_response) as mock_post:
        assert service.get_response(
            model="gpt-4o",
            api_key="",
            messages=[{"role": "user", "content": "Answer"}],
            api_base=None,
        ) == ("Feedback", None)

    assert mock_post.call_args.kwargs["timeout"] == DEFAULT_HTTP_TIMEOUT


@pytest.mark.parametrize(
    "backend_config, expected_backend_class",
    [
        # Default to judge0 when no custom config
        ({}, Judge0Backend),
        # Use custom backend when configured
        ({'backend': 'custom', 'custom_config': {'base_url': 'http://test.com'}}, CustomServiceBackend),
        # Use judge0 when explicitly set
        ({'backend': 'judge0', 'judge0_config': {}}, Judge0Backend),
    ],
)
def test_backend_factory_selection(backend_config, expected_backend_class):
    """Test BackendFactory returns correct backend based on Django settings."""
    with patch('django.conf.settings') as mock_settings:
        mock_settings.AI_EVAL_CODE_EXECUTION_BACKEND = backend_config
        backend = BackendFactory.get_backend(api_key="test-key")
        assert isinstance(backend, expected_backend_class)


def test_backend_factory_uses_judge0_config_api_key():
    """Judge0 backend should source API key from Django backend config."""
    with patch('django.conf.settings') as mock_settings:
        mock_settings.AI_EVAL_CODE_EXECUTION_BACKEND = {
            'backend': 'judge0',
            'judge0_config': {
                'api_key': 'config-key',
                'base_url': 'http://localhost:2358',
            },
        }
        backend = BackendFactory.get_backend()
        assert isinstance(backend, Judge0Backend)
        assert backend.api_key == "config-key"
        assert backend.base_url == "http://localhost:2358"


def test_backend_factory_uses_xblock_judge0_key_when_backend_config_absent():
    """Judge0 backend should use XBlock key when backend setting is not configured."""
    with patch('django.conf.settings', new=SimpleNamespace()):
        backend = BackendFactory.get_backend(api_key="xblock-key")
        assert isinstance(backend, Judge0Backend)
        assert backend.api_key == "xblock-key"


def test_backend_factory_does_not_fallback_when_backend_config_present_but_empty():
    """Judge0 backend should ignore XBlock key when backend setting exists, even if empty."""
    with patch('django.conf.settings') as mock_settings:
        mock_settings.AI_EVAL_CODE_EXECUTION_BACKEND = {}
        backend = BackendFactory.get_backend(api_key="xblock-key")
        assert isinstance(backend, Judge0Backend)
        assert backend.api_key == ""


def test_judge0_backend_initialization():
    """Test Judge0Backend initializes with correct API key."""
    backend = Judge0Backend(api_key="test-key")
    assert backend.api_key == "test-key"
    assert backend.base_url == "https://judge0-ce.p.rapidapi.com"


def test_judge0_backend_with_custom_base_url():
    """Test Judge0Backend initializes with custom base URL."""
    backend = Judge0Backend(api_key="test-key", base_url="http://localhost:2358")
    assert backend.api_key == "test-key"
    assert backend.base_url == "http://localhost:2358"


@patch('ai_eval.backends.custom.requests.get')
def test_custom_backend_initialization(mock_get):
    """Test CustomServiceBackend initializes with correct config."""
    mock_response = Mock()
    mock_response.json.return_value = [
        {"id": "92", "name": "Python (3.8.1)"},
        {"id": "93", "name": "JavaScript (Node.js 12.14.0)"},
        {"id": "91", "name": "Java (OpenJDK 13.0.1)"},
        {"id": "54", "name": "C++ (GCC 9.2.0)"}
    ]
    mock_response.raise_for_status = Mock()
    mock_get.return_value = mock_response
    backend = CustomServiceBackend(
        submit_endpoint="http://test.com/submit",
        results_endpoint="http://test.com/results/{submission_id}",
        languages_endpoint="http://test.com/languages",
        api_key="test-key",
        timeout=60
    )
    assert backend.submit_endpoint == "http://test.com/submit"
    assert backend.results_endpoint == "http://test.com/results/{submission_id}"
    assert backend.languages_endpoint == "http://test.com/languages"
    assert backend.api_key == "test-key"
    assert backend.timeout == 60


@patch('ai_eval.backends.judge0.requests.post')
def test_judge0_submit_code(mock_post):
    """Test Judge0Backend.submit_code method."""
    mock_response = Mock()
    mock_response.json.return_value = {"token": "test-token"}
    mock_response.raise_for_status = Mock()
    mock_post.return_value = mock_response

    backend = Judge0Backend(api_key="test-key")
    submission_id = backend.submit_code("print('hello')", "Python (3.8.1)")

    assert submission_id == "test-token"
    mock_post.assert_called_once()


@patch('ai_eval.backends.judge0.requests.get')
def test_judge0_get_result(mock_get):
    """Test Judge0Backend.get_result method."""
    mock_response = Mock()
    mock_response.json.return_value = {
        "status": {"id": 3, "description": "Accepted"},
        "stdout": "hello\n",
        "stderr": None,
        "compile_output": None,
        "time": "0.01",
        "memory": "1024"
    }
    mock_response.raise_for_status = Mock()
    mock_get.return_value = mock_response

    backend = Judge0Backend(api_key="test-key")
    result = backend.get_result("test-token")

    assert result["status"]["description"] == "Accepted"
    assert result["stdout"] == "hello\n"
    mock_get.assert_called_once()


@patch('ai_eval.backends.custom.requests.get')
@patch('ai_eval.backends.custom.requests.post')
def test_custom_submit_code(mock_post, mock_get):
    """Test CustomServiceBackend.submit_code method."""
    lang_resp = Mock()
    lang_resp.json.return_value = [
        {"name": "Python (3.8.1)"},
        {"name": "JavaScript (Node.js 12.14.0)"},
        {"name": "Java (OpenJDK 13.0.1)"},
        {"name": "C++ (GCC 9.2.0)"}
    ]
    lang_resp.raise_for_status = Mock()
    mock_get.return_value = lang_resp

    mock_response = Mock()
    mock_response.json.return_value = {"submission_id": "test-token"}
    mock_response.raise_for_status = Mock()
    mock_post.return_value = mock_response

    backend = CustomServiceBackend(
        submit_endpoint="http://test.com/submit",
        results_endpoint="http://test.com/results/{submission_id}",
        languages_endpoint="http://test.com/languages"
    )
    submission_id = backend.submit_code("print('hello')", "Python (3.8.1)")

    assert submission_id == "test-token"
    mock_post.assert_called_once()


@patch('ai_eval.backends.custom.requests.get')
def test_custom_backend_language_validation_fails(mock_get):
    """Test CustomServiceBackend raises error for unsupported languages."""
    mock_response = Mock()
    mock_response.json.return_value = [
        {"name": "Python (3.8.1)"}  # Only Python supported
    ]
    mock_response.raise_for_status = Mock()
    mock_get.return_value = mock_response

    with pytest.raises(ValueError) as exc_info:
        backend = CustomServiceBackend(
            submit_endpoint="http://test.com/submit",
            results_endpoint="http://test.com/results/{submission_id}",
            languages_endpoint="http://test.com/languages",
            api_key="test-key"
        )
        backend._ensure_languages_validated()

    assert "does not support languages" in str(exc_info.value)


@patch('ai_eval.backends.custom.requests.get')
def test_custom_get_result(mock_get):
    """Test CustomServiceBackend.get_result method."""
    lang_resp = Mock()
    lang_resp.json.return_value = [
        {"name": "Python (3.8.1)"},
        {"name": "JavaScript (Node.js 12.14.0)"},
        {"name": "Java (OpenJDK 13.0.1)"},
        {"name": "C++ (GCC 9.2.0)"}
    ]
    lang_resp.raise_for_status = Mock()

    result_resp = Mock()
    result_resp.json.return_value = {
        "status": "Completed",
        "stdout": "hello\n",
        "stderr": None
    }
    result_resp.raise_for_status = Mock()
    mock_get.side_effect = [lang_resp, result_resp]

    backend = CustomServiceBackend(
        submit_endpoint="http://test.com/submit",
        results_endpoint="http://test.com/results/{submission_id}",
        languages_endpoint="http://test.com/languages"
    )
    result = backend.get_result("test-token")

    assert result["status"]["description"] == "Completed"
    assert result["stdout"] == "hello\n"
    assert mock_get.call_count == 2


@pytest.mark.parametrize(
    "xblock_key, site_config_key, settings_dict, expected_result",
    [
        # Site configuration takes precedence over XBlock field for API keys
        ("xblock-key", "site-config-key", {"GPT4O_API_KEY": "settings-key"}, "site-config-key"),
        # Global settings take precedence over XBlock field for API keys
        ("xblock-key", None, {"GPT4O_API_KEY": "settings-key"}, "settings-key"),
        # Fall back to site configuration
        ("", "site-config-key", {"GPT4O_API_KEY": "settings-key"}, "site-config-key"),
        # Fall back to settings
        ("", None, {"GPT4O_API_KEY": "settings-key"}, "settings-key"),
        # No API key found
        ("", None, {}, None),
    ],
)
def test_get_model_config_value_fallback_chain(
    ai_eval_block, xblock_key, site_config_key, settings_dict, expected_result
):
    """
    Test API key fallback chain with different scenarios.
    """
    ai_eval_block.model_api_key = xblock_key
    ai_eval_block._get_settings = Mock(return_value=settings_dict)

    with patch("ai_eval.base.get_site_configuration_value", return_value=site_config_key):
        api_key = ai_eval_block.get_model_api_key()

    assert api_key == expected_result


@patch.object(AIEvalXBlock, '_get_model_config_value', return_value="test-key")
def test_get_model_api_key_delegates(mock_get_config, ai_eval_block):
    """Test that get_model_api_key delegates to _get_model_config_value."""
    assert ai_eval_block.get_model_api_key() == "test-key"
    mock_get_config.assert_called_once_with("api_key", None)


@patch.object(AIEvalXBlock, '_get_model_config_value', return_value="test-url")
def test_get_model_api_url_delegates(mock_get_config, ai_eval_block):
    """Test that get_model_api_url delegates to _get_model_config_value."""
    assert ai_eval_block.get_model_api_url() == "test-url"
    mock_get_config.assert_called_once_with("api_url", None)


@patch('ai_eval.coding_ai_eval.BackendFactory.get_backend')
def test_coding_block_submit_code_uses_backend(mock_get_backend, coding_block_data):
    """Test CodingAIEvalXBlock.submit_code_handler uses backend system."""
    mock_backend = Mock()
    mock_backend.submit_code.return_value = "test-submission-id"
    mock_get_backend.return_value = mock_backend

    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    result = block.submit_code_handler.__wrapped__(block, data={"user_code": "print('hello')"})

    assert result == {"submission_id": "test-submission-id"}
    mock_get_backend.assert_called_once_with(block.judge0_api_key)
    mock_backend.submit_code.assert_called_once_with("print('hello')", "Python (3.8.1)")


@patch.object(CodingAIEvalXBlock, 'get_llm_response', return_value="Looks good")
def test_coding_block_get_response_persists_current_session(mock_get_llm, coding_block_data):
    """Coding responses should replace the current session entry for persistence."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)

    result = block.get_response.__wrapped__(
        block,
        data={
            "code": "print('hello')",
            "stdout": "hello",
            "stderr": "",
        },
    )

    assert result == {"response": "Looks good"}
    assert block.sessions == [{
        "USER_RESPONSE": "print('hello')",
        "AI_EVALUATION": "Looks good",
        "CODE_EXEC_RESULT": {
            "stdout": "hello",
            "stderr": "",
        },
    }]
    mock_get_llm.assert_called_once()


def test_coding_block_reset_appends_blank_session(coding_block_data):
    """Reset should create a fresh blank session."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    block.sessions = [{
        "USER_RESPONSE": "print('hello')",
        "AI_EVALUATION": "Looks good",
        "CODE_EXEC_RESULT": {
            "stdout": "hello",
            "stderr": "",
        },
    }]

    result = block.reset_handler.__wrapped__(block, data={})

    assert result == {"message": "reset successful."}
    assert block.sessions == [
        {
            "USER_RESPONSE": "print('hello')",
            "AI_EVALUATION": "Looks good",
            "CODE_EXEC_RESULT": {
                "stdout": "hello",
                "stderr": "",
            },
        },
        {
            "USER_RESPONSE": "",
            "AI_EVALUATION": "",
            "CODE_EXEC_RESULT": {},
        },
    ]


@patch('ai_eval.coding_ai_eval.BackendFactory.get_backend')
def test_coding_block_get_submission_result_uses_backend(mock_get_backend, coding_block_data):
    """Test CodingAIEvalXBlock.get_submission_result_handler uses backend system."""
    mock_backend = Mock()
    mock_backend.get_result.return_value = {"status": "Accepted"}
    mock_get_backend.return_value = mock_backend

    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    result = block.get_submission_result_handler.__wrapped__(block, data={"submission_id": "test-id"})

    assert result == {"status": "Accepted"}
    mock_get_backend.assert_called_once_with(block.judge0_api_key)
    mock_backend.get_result.assert_called_once_with("test-id")


def test_should_lock_model_api_key_field_when_site_key_exists(ai_eval_block):
    """Model API key field should lock when site/global key is available."""
    ai_eval_block._get_settings = Mock(return_value={})
    with patch("ai_eval.base.get_site_configuration_value", return_value="site-key"):
        assert ai_eval_block.should_lock_model_api_key_field()


def test_should_lock_model_api_key_field_when_custom_service_enabled(ai_eval_block):
    """Model API key field should lock when custom LLM service is enabled."""
    ai_eval_block._get_settings = Mock(return_value={})
    with patch("ai_eval.base.get_site_configuration_value", return_value=True):
        assert ai_eval_block.should_lock_model_api_key_field()


def test_should_not_lock_model_api_key_field_without_site_key_or_custom_service(ai_eval_block):
    """Model API key field should remain editable without global/site key and custom LLM."""
    ai_eval_block._get_settings = Mock(return_value={})
    with patch("ai_eval.base.get_site_configuration_value", return_value=None):
        assert not ai_eval_block.should_lock_model_api_key_field()


def test_studio_lock_payload_locks_model_api_key_when_locked(ai_eval_block):
    """Studio payload should lock model API key when globally configured."""
    ai_eval_block._get_settings = Mock(return_value={})
    with patch("ai_eval.base.get_site_configuration_value", return_value="site-key"):
        payload = ai_eval_block._studio_lock_metadata()
        assert payload["lock_model_api_key_initial"] is True


def test_studio_lock_payload_keeps_model_api_key_unlocked_without_config(ai_eval_block):
    """Studio payload should keep model API key editable without global/site config."""
    ai_eval_block._get_settings = Mock(return_value={})
    with patch("ai_eval.base.get_site_configuration_value", return_value=None):
        payload = ai_eval_block._studio_lock_metadata()
        assert payload["lock_model_api_key_initial"] is False
        assert payload["model_key_presence"][SupportedModels.GPT4O.value] is False


def test_should_lock_judge0_api_key_field_when_backend_has_judge0_key(coding_block_data):
    """Judge0 field should lock when runtime settings provide judge0 backend key."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    with patch(
        'ai_eval.coding_ai_eval.settings',
        new=SimpleNamespace(
            AI_EVAL_CODE_EXECUTION_BACKEND={
                "backend": "judge0",
                "judge0_config": {"api_key": "config-key"},
            }
        ),
    ):
        assert block.should_lock_judge0_api_key_field()


def test_should_not_lock_judge0_api_key_field_when_backend_setting_absent(coding_block_data):
    """Judge0 field should be editable when backend setting is absent."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    with patch('ai_eval.coding_ai_eval.settings', new=SimpleNamespace()):
        assert not block.should_lock_judge0_api_key_field()


def test_should_not_lock_judge0_api_key_field_without_runtime_judge0_key(coding_block_data):
    """Judge0 field should remain editable when runtime judge0 key is missing."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    with patch(
        'ai_eval.coding_ai_eval.settings',
        new=SimpleNamespace(
            AI_EVAL_CODE_EXECUTION_BACKEND={
                "backend": "judge0",
                "judge0_config": {},
            }
        ),
    ):
        assert not block.should_lock_judge0_api_key_field()


def test_should_not_lock_judge0_api_key_field_for_custom_backend(coding_block_data):
    """Judge0 field should remain editable when runtime backend is custom."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    with patch(
        'ai_eval.coding_ai_eval.settings',
        new=SimpleNamespace(
            AI_EVAL_CODE_EXECUTION_BACKEND={
                "backend": "custom",
                "custom_config": {"api_key": "custom-key"},
            }
        ),
    ):
        assert not block.should_lock_judge0_api_key_field()


def test_coding_studio_lock_payload_sets_judge0_lock_flag(coding_block_data):
    """Coding Studio payload should include judge0 lock flag when runtime key is configured."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    block._get_settings = Mock(return_value={})
    with patch(
        'ai_eval.coding_ai_eval.settings',
        new=SimpleNamespace(
            AI_EVAL_CODE_EXECUTION_BACKEND={
                "backend": "judge0",
                "judge0_config": {"api_key": "config-key"},
            }
        ),
    ), patch("ai_eval.base.get_site_configuration_value", return_value=None):
        payload = block._studio_lock_metadata()
        assert payload["lock_judge0_api_key"] is True


def test_coding_studio_lock_payload_unsets_judge0_lock_flag_without_runtime_key(coding_block_data):
    """Coding Studio payload should not lock judge0 field without runtime judge0 key."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    block._get_settings = Mock(return_value={})
    with patch('ai_eval.coding_ai_eval.settings', new=SimpleNamespace()), \
            patch("ai_eval.base.get_site_configuration_value", return_value=None):
        payload = block._studio_lock_metadata()
        assert payload["lock_judge0_api_key"] is False
