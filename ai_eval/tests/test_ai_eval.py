"""
Testing module.
"""
# pylint: disable=redefined-outer-name,protected-access

import hashlib
import io
import logging
import base64
import json
import urllib.request
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
import time_machine
from django.core.cache import cache
from xblock.exceptions import JsonHandlerError
from xblock.field_data import DictFieldData
from xblock.test.toy_runtime import ToyRuntime as _ToyRuntime

from ai_eval import (
    CodingAIEvalXBlock,
    CoachAIEvalXBlock,
    ShortAnswerAIEvalXBlock,
)
from ai_eval.base import AIEvalXBlock
from ai_eval.supported_models import SupportedModels, resolve_model
from ai_eval.llm_services import CustomLLMService
from ai_eval.backends.factory import BackendFactory
from ai_eval.backends.judge0 import Judge0Backend
from ai_eval.backends.custom import CustomServiceBackend
from ai_eval.utils import DEFAULT_HTTP_TIMEOUT, SUPPORTED_LANGUAGE_MAP, LanguageLabels


DEFAULT_FROZEN_TIME = "2000-01-02T00:00:00+00:00"


class FakeUser():
    """A fake hardcoded user object for use with the local runtime."""
    emails = ["testuser@example.com"]
    full_name = "Test User"


class FakeUserService:
    """A fake user service for use with the local runtime."""
    def get_current_user(self):
        return FakeUser()


class ToyRuntime(_ToyRuntime):  # pylint: disable=abstract-method
    """A toy xblock runtime that adds a user service."""
    def __init__(self, user_id=None):
        super().__init__(user_id)
        self._services["user"] = FakeUserService()


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
        "pdf_download_allowed": True,
        "pdf_download_description": "",
        "pdf_download_title": "Download transcript",
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
        "show_display_name": False,
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
        "pdf_download_allowed": True,
        "pdf_download_description": "",
        "pdf_download_title": "Download transcript",
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
        "pdf_download_allowed": True,
        "pdf_download_description": "",
        "pdf_download_title": "Download transcript",
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
            "download_pdf": "/handler/download_pdf",
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
            "monaco_html_b64": base64.b64encode(monaco_html.encode("utf-8")).decode("ascii"),
            "pdf_download_allowed": True,
            "pdf_download_description": "",
            "pdf_download_title": "Download transcript",
        },
        "mfe_config_api": "http://local.openedx.io:8000/api/mfe_config/v1?mfe=learning",
        "style_urls": [
            "http://local.openedx.io:8000",
            "http://local.openedx.io:8000",
        ],
    }
    assert '<div data-ai-eval-react-root="true"></div>' in frag.content


@patch("ai_eval.base.get_site_configuration_value", Mock(return_value=""))
def test_coding_block_pdf(coding_block_data):
    """Test generating a pdf for CodingAIEvalXBlock."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)

    pdf_response = block.download_pdf("")

    assert pdf_response.status == "200 OK"


@patch("ai_eval.base.get_site_configuration_value", Mock(return_value=""))
def test_coding_block_pdf_not_allowed(coding_block_data):
    """Test generating a pdf for CodingAIEvalXBlock."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    block.pdf_download_allowed = False

    pdf_response = block.download_pdf("")

    assert pdf_response.status == "400 Bad Request"
    assert "disabled" in json.loads(pdf_response.body)["error"]


@patch("ai_eval.base.get_site_configuration_value", Mock(return_value=""))
def test_shortanswer_block_pdf(shortanswer_block_data):
    """Test generating a pdf for ShortAnswerAIEvalXBlock."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)

    pdf_response = block.download_pdf("")

    assert pdf_response.status == "200 OK"


@patch("ai_eval.base.get_site_configuration_value", Mock(return_value=""))
def test_shortanswer_block_pdf_not_allowed(shortanswer_block_data):
    """Test generating a pdf for ShortAnswerAIEvalXBlock."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block.pdf_download_allowed = False

    pdf_response = block.download_pdf("")

    assert pdf_response.status == "400 Bad Request"
    assert "disabled" in json.loads(pdf_response.body)["error"]


@patch("ai_eval.base.get_site_configuration_value", Mock(return_value=""))
def test_coach_block_pdf(coach_block_data):
    """Test generating a pdf for Coach AI block."""
    session = {
        "workspace_history": [{
            "character_index": 0,
            "user_message": "final learner answer",
            "character_message": "patient reply",
        }],
        "coach_history": [],
        "evaluation_fragments": [{
            "character_index": 0,
            "user_message": "",
            "character_message": "# Evaluation Report",
            "time": DEFAULT_FROZEN_TIME,
            "is_evaluation": True,
        }],
        "attempts_used": 1,
        "finished": True,
        "final_submission": "final learner answer",
        "final_evaluation_markdown": "# Evaluation Report",
    }
    block = CoachAIEvalXBlock(
        ToyRuntime(),
        DictFieldData(
            {
                **coach_block_data,
                "initial_message": "hello, I am your evaluator",
                "coach_initial_message": "hello, I am your coach",
                "sessions": [session],
            }
        ),
        None,
    )

    pdf_response = block.download_pdf("")

    assert pdf_response.status == "200 OK"


@patch("ai_eval.base.get_site_configuration_value", Mock(return_value=""))
def test_coach_block_pdf_not_allowed(coach_block_data):
    """Test generating a pdf for Coach AI block."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)
    block.pdf_download_allowed = False

    pdf_response = block.download_pdf("")

    assert pdf_response.status == "400 Bad Request"
    assert "disabled" in json.loads(pdf_response.body)["error"]


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
    assert '<div data-ai-eval-react-root="true"' in frag.content
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


@patch("ai_eval.base.get_site_configuration_value", Mock(return_value=None))
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
            "download_pdf": "/handler/download_pdf",
        },
        "initial_state": {
            "messages": shortanswer_block_data["sessions"][-1],
        },
        "meta": {
            "title": "",
            "question": shortanswer_block_data["question"],
            "max_responses": shortanswer_block_data["max_responses"],
            "character_limit": 1000,
            "allow_reset": shortanswer_block_data["allow_reset"],
            "character_image": shortanswer_block_data["character_image"],
            "hide_question": shortanswer_block_data["hide_question"],
            "pdf_download_allowed": True,
            "pdf_download_description": "",
            "pdf_download_title": "Download transcript",
        },
        "mfe_config_api": "http://local.openedx.io:8000/api/mfe_config/v1?mfe=learning",
        "style_urls": [
            "http://local.openedx.io:8000",
            "http://local.openedx.io:8000",
        ],
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


@patch("ai_eval.base.get_site_configuration_value", Mock(return_value=None))
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


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, 1000),
        (2000, 2000),
        ("2000", 2000),
        ("abc", 1000),
        (0, 1000),
        (-5, 1000),
        (50_000, 50_000),
    ],
)
def test_learner_input_character_limit_resolution(shortanswer_block_data, raw, expected):
    """The configured limit is parsed leniently and invalid values fall back to the default."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block._get_settings = Mock(return_value={"SHORTANSWER_CHARACTER_LIMIT": raw})
    with patch("ai_eval.base.get_site_configuration_value", return_value=None):
        assert block._learner_input_character_limit() == expected


@pytest.mark.parametrize("raw", ["abc", 0, -5])
def test_learner_input_character_limit_warns_on_invalid_value(shortanswer_block_data, raw, caplog):
    """A value that is present but invalid is ignored with a logged warning."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block._get_settings = Mock(return_value={"SHORTANSWER_CHARACTER_LIMIT": raw})
    with patch("ai_eval.base.get_site_configuration_value", return_value=None):
        with caplog.at_level(logging.WARNING, logger="ai_eval.base"):
            assert block._learner_input_character_limit() == 1000
    assert "SHORTANSWER_CHARACTER_LIMIT" in caplog.text


def test_learner_input_character_limit_absent_is_silent(shortanswer_block_data, caplog):
    """An absent setting falls back to the default without logging."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block._get_settings = Mock(return_value={})
    with patch("ai_eval.base.get_site_configuration_value", return_value=None):
        with caplog.at_level(logging.WARNING, logger="ai_eval.base"):
            assert block._learner_input_character_limit() == 1000
    assert not caplog.records


def test_learner_input_character_limit_site_config_precedence(shortanswer_block_data):
    """A site configuration value wins over the Django settings bucket."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block._get_settings = Mock(return_value={"SHORTANSWER_CHARACTER_LIMIT": 2000})
    with patch(
        "ai_eval.base.get_site_configuration_value",
        side_effect=_fake_site_config({"SHORTANSWER_CHARACTER_LIMIT": "1500"}),
    ):
        assert block._learner_input_character_limit() == 1500


def test_shortanswer_meta_character_limit_uses_setting(shortanswer_block_data):
    """The resolved limit is exposed to the frontend through the view meta payload."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block._get_settings = Mock(return_value={"SHORTANSWER_CHARACTER_LIMIT": 2000})
    with patch("ai_eval.base.get_site_configuration_value", return_value=None), \
         patch.object(block.runtime, "handler_url", side_effect=_mock_handler_url):
        frag = block.student_view()
    assert frag.json_init_args["meta"]["character_limit"] == 2000


def test_shortanswer_get_response_rejects_over_limit_input(shortanswer_block_data):
    """Input over the limit gets a 400 without reaching the LLM."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    with patch("ai_eval.base.get_site_configuration_value", return_value=None), \
         patch("ai_eval.base.get_llm_response") as mocked_llm:
        with pytest.raises(JsonHandlerError) as excinfo:
            block.get_response.__wrapped__(block, data={"user_input": "x" * 1001})
    assert excinfo.value.status_code == 400
    assert "1000" in excinfo.value.message
    mocked_llm.assert_not_called()


def test_shortanswer_get_response_accepts_input_at_limit(shortanswer_block_data):
    """Input exactly at the limit is processed normally."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    with patch("ai_eval.shortanswer.get_llm_service") as mock_service, \
         patch("ai_eval.llm.get_llm_service") as mock_llm_service, \
         patch("ai_eval.base.get_site_configuration_value", return_value=None), \
         patch("ai_eval.base.get_llm_response") as mocked_llm:
        mock_service.return_value = Mock()
        mock_service.return_value.supports_threads.return_value = False
        mock_llm_service.return_value = mock_service.return_value
        mocked_llm.return_value = (".", None)
        block.get_response.__wrapped__(block, data={"user_input": "x" * 1000})
    mocked_llm.assert_called_once()


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
    assert '<div data-ai-eval-react-root="true"' in frag.content
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
            "download_pdf": "/handler/download_pdf",
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
            "pdf_download_allowed": True,
            "pdf_download_description": "",
            "pdf_download_title": "Download transcript",
        },
        "mfe_config_api": "http://local.openedx.io:8000/api/mfe_config/v1?mfe=learning",
        "style_urls": [
            "http://local.openedx.io:8000",
            "http://local.openedx.io:8000",
        ],
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
    assert '<div data-ai-eval-react-root="true"' in frag.content
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


@time_machine.travel(DEFAULT_FROZEN_TIME, tick=False)
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
                "time": DEFAULT_FROZEN_TIME,
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


@time_machine.travel(DEFAULT_FROZEN_TIME, tick=False)
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
            "time": DEFAULT_FROZEN_TIME,
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
        "pdf_download_allowed": ["Missing field in Studio payload."],
        "pdf_download_description": ["Missing field in Studio payload."],
        "pdf_download_title": ["Missing field in Studio payload."],
        "workspace_attachment_urls": ["Missing field in Studio payload."],
        "coach_attachment_urls": ["Missing field in Studio payload."],
        "evaluator_attachment_urls": ["Missing field in Studio payload."],
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
                    "show_display_name": False,
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
                    "pdf_download_allowed": False,
                    "pdf_download_description": "",
                    "pdf_download_title": "Download transcript",
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
                    "show_display_name": False,
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
                    "pdf_download_allowed": False,
                    "pdf_download_description": "",
                    "pdf_download_title": "",
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
        "show_display_name": ["Missing field in Studio payload."],
        "question": ["Missing field in Studio payload."],
        "evaluation_prompt": ["Missing field in Studio payload."],
        "max_responses": ["Missing field in Studio payload."],
        "allow_reset": ["Missing field in Studio payload."],
        "character_image": ["Missing field in Studio payload."],
        "attachment_urls": ["Missing field in Studio payload."],
        "hide_question": ["Missing field in Studio payload."],
        "pdf_download_allowed": ["Missing field in Studio payload."],
        "pdf_download_description": ["Missing field in Studio payload."],
        "pdf_download_title": ["Missing field in Studio payload."],
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
                    "show_display_name": False,
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
                    "pdf_download_allowed": False,
                    "pdf_download_description": "",
                    "pdf_download_title": "Download transcript",
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
                    "pdf_download_allowed": False,
                    "pdf_download_description": "",
                    "pdf_download_title": "Download transcript",
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
                    "pdf_download_allowed": False,
                    "pdf_download_description": "",
                    "pdf_download_title": "",
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
        "pdf_download_allowed": ["Missing field in Studio payload."],
        "pdf_download_description": ["Missing field in Studio payload."],
        "pdf_download_title": ["Missing field in Studio payload."],
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
                    "pdf_download_allowed": False,
                    "pdf_download_description": "",
                    "pdf_download_title": "",
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
    cache.clear()
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    urllib.request.urlopen = Mock(return_value=io.BytesIO("á".encode('latin-1')))
    contents = block._download_attachment("http://example.com/1.txt")
    assert contents == "á"


def _mock_urlopen_bytes(payload: bytes):
    """Return a urlopen mock whose context manager reads back ``payload``."""
    mock_open = Mock()
    mock_open.return_value.__enter__ = Mock(return_value=Mock(read=Mock(return_value=payload)))
    mock_open.return_value.__exit__ = Mock(return_value=False)
    return mock_open


def test_download_attachment_caches_across_calls(shortanswer_block_data):
    """A second read of the same URL is served from cache without re-downloading."""
    cache.clear()
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    url = "http://example.com/cached.txt"

    with patch("ai_eval.base.urllib.request.urlopen", _mock_urlopen_bytes(b"hello world")) as mock_open:
        first = block._get_attachments([url])
        second = block._get_attachments([url])

    assert first == second == [("cached.txt", "hello world")]
    assert mock_open.call_count == 1


def test_download_attachment_refresh_bypasses_cache(shortanswer_block_data):
    """refresh=True forces a fresh download and repopulates the cache entry."""
    cache.clear()
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    url = "http://example.com/refresh.txt"

    with patch("ai_eval.base.urllib.request.urlopen", _mock_urlopen_bytes(b"hello world")) as mock_open:
        block._download_attachment(url)            # miss -> download
        block._download_attachment(url)            # hit  -> no download
        block._download_attachment(url, refresh=True)  # bypass -> download again

    assert mock_open.call_count == 2


def test_download_attachment_skips_caching_oversized_values(shortanswer_block_data):
    """Values over ATTACHMENT_CACHE_MAX_BYTES are fetched every time, never cached."""
    cache.clear()
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    block.ATTACHMENT_CACHE_MAX_BYTES = 5  # "hello world" is larger than this
    url = "http://example.com/big.txt"

    with patch("ai_eval.base.urllib.request.urlopen", _mock_urlopen_bytes(b"hello world")) as mock_open:
        block._download_attachment(url)
        block._download_attachment(url)

    assert mock_open.call_count == 2
    assert cache.get(
        "ai_eval:attachment:" + hashlib.sha256(url.encode("utf-8")).hexdigest()
    ) is None


def _coach_block_with_attachments(coach_block_data, **overrides):
    """Build a Coaching block whose attachment downloads echo a per-URL token."""
    data = {
        **coach_block_data,
        "workspace_attachment_urls": ["http://example.com/workspace.txt"],
        "coach_attachment_urls": ["http://example.com/coach.txt"],
        "evaluator_attachment_urls": ["http://example.com/eval.txt"],
        **overrides,
    }
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    block._download_attachment = Mock(side_effect=lambda url, refresh=False: f"BODY[{url}]")
    return block


def test_coach_attachments_for_cascade(coach_block_data):
    """Visibility cascades upward: workspace ⊆ coach ⊆ evaluator."""
    block = _coach_block_with_attachments(coach_block_data)

    assert block._attachments_for("workspace") == ["http://example.com/workspace.txt"]
    assert block._attachments_for("coach") == [
        "http://example.com/workspace.txt",
        "http://example.com/coach.txt",
    ]
    assert block._attachments_for("evaluator") == [
        "http://example.com/workspace.txt",
        "http://example.com/coach.txt",
        "http://example.com/eval.txt",
    ]


def _system_prompt(messages):
    """Return the system message content from an LLM message iterable."""
    return next(message for message in messages if message["role"] == "system")["content"]


def test_coach_attachments_injected_per_audience(coach_block_data):
    """Each agent's prompt sees exactly the attachments its audience is allowed."""
    block = _coach_block_with_attachments(coach_block_data)

    workspace_prompt = _system_prompt(block._messages_for_character(0, "hi"))
    assert "<filename>workspace.txt</filename>" in workspace_prompt
    assert "coach.txt" not in workspace_prompt
    assert "eval.txt" not in workspace_prompt

    coach_prompt = _system_prompt(block._messages_for_character(1, "hi"))
    assert "<filename>workspace.txt</filename>" in coach_prompt
    assert "<filename>coach.txt</filename>" in coach_prompt
    assert "eval.txt" not in coach_prompt


@patch("ai_eval.coach.get_llm_service", return_value=Mock())
@patch.object(CoachAIEvalXBlock, "_render_final_report", return_value="<article>report</article>")
def test_coach_evaluator_prompt_sees_all_attachments(
    _mock_render_report,
    _mock_get_llm_service,
    coach_block_data,
):
    """The evaluator prompt sees workspace, coach, and evaluator attachments."""
    session = _empty_coach_session()
    session["workspace_history"] = [{
        "character_index": 0,
        "user_message": "final answer",
        "character_message": "reply",
    }]
    block = _coach_block_with_attachments(coach_block_data, sessions=[session])

    captured = {}

    def _capture(messages, tag=None):  # pylint: disable=unused-argument
        captured["prompt"] = _system_prompt(messages)
        return "# Evaluation Report"

    block.get_llm_response = Mock(side_effect=_capture)
    block.get_evaluator_response.__wrapped__(block, data={})

    prompt = captured["prompt"]
    assert "<filename>workspace.txt</filename>" in prompt
    assert "<filename>coach.txt</filename>" in prompt
    assert "<filename>eval.txt</filename>" in prompt


def test_coach_thread_tag_changes_with_attachment_urls(coach_block_data):
    """Changing an attachment URL invalidates the cached provider thread tag."""
    with patch("ai_eval.coach.get_llm_service", return_value=Mock()):
        base_block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(dict(coach_block_data)), None)
        tagged_block = CoachAIEvalXBlock(
            ToyRuntime(),
            DictFieldData({**coach_block_data, "workspace_attachment_urls": ["http://example.com/new.txt"]}),
            None,
        )
        assert base_block._get_thread_tag("character0") != tagged_block._get_thread_tag("character0")


def test_coach_studio_validation_flags_unreachable_attachment(coach_block_data):
    """A bad URL in any attachment list surfaces a per-field Studio error."""
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)

    # Mock the network call, not _get_attachments, so the real download/error
    # wrapping path runs and we assert the actual author-facing message.
    def _fail_for_bad_url(url, refresh=False):  # pylint: disable=unused-argument
        if url == "http://example.com/bad.txt":
            raise Exception("download failed")
        return "contents"

    block._download_attachment = Mock(side_effect=_fail_for_bad_url)
    mock_service = Mock()
    mock_service.get_available_models.return_value = [SupportedModels.GPT4O.value]

    with patch("ai_eval.base.get_llm_service", return_value=mock_service), \
         patch("ai_eval.coach.get_llm_service", return_value=mock_service), \
         patch("ai_eval.base.get_site_configuration_value", return_value=None):
        response = block.studio_submit.__wrapped__(
            block,
            {
                field_name: getattr(block, field_name)
                for field_name in block.editable_fields
            } | {"coach_attachment_urls": ["http://example.com/bad.txt"]},
        )

    assert response["success"] is False
    assert response["validation_errors"]["coach_attachment_urls"] == [
        'Error downloading attachment "http://example.com/bad.txt"',
    ]
    assert "workspace_attachment_urls" not in response["validation_errors"]
    assert "evaluator_attachment_urls" not in response["validation_errors"]


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


@time_machine.travel(DEFAULT_FROZEN_TIME, tick=False)
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
        "TIME": DEFAULT_FROZEN_TIME,
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


# Legacy model compatibility shim: activities saved with a provider-retired model id
# (Anthropic's claude-sonnet-4-20250514) keep working by resolving to the replacement
# (claude-sonnet-4-6) at runtime, with no course-content edits.
LEGACY_CLAUDE = "claude-sonnet-4-20250514"


def _fake_site_config(values):
    """Build a get_site_configuration_value replacement backed by a {config_key: value} dict."""
    def _fake(_block_settings_key, config_key):
        return values.get(config_key)
    return _fake


def test_resolve_model_maps_legacy_to_replacement():
    """resolve_model should map the retired id, and pass through everything else."""
    assert resolve_model(LEGACY_CLAUDE) == SupportedModels.CLAUDE_SONNET.value
    assert resolve_model(SupportedModels.CLAUDE_SONNET.value) == SupportedModels.CLAUDE_SONNET.value
    assert resolve_model(SupportedModels.GPT4O.value) == SupportedModels.GPT4O.value
    assert resolve_model("some/custom-model") == "some/custom-model"


def test_resolve_model_follows_alias_chain():
    """A chained alias (code default -> operator replacement) resolves to the end of the chain."""
    # e.g. code: claude-sonnet-4-20250514 -> claude-sonnet-4-6;
    #      operator DEPRECATED_MODELS:     claude-sonnet-4-6 -> claude-sonnet-4-10
    aliases = {
        LEGACY_CLAUDE: SupportedModels.CLAUDE_SONNET.value,
        SupportedModels.CLAUDE_SONNET.value: "claude-sonnet-4-10",
    }
    assert resolve_model(LEGACY_CLAUDE, aliases) == "claude-sonnet-4-10"
    assert resolve_model(SupportedModels.CLAUDE_SONNET.value, aliases) == "claude-sonnet-4-10"


def test_resolve_model_terminates_on_cycle():
    """A misconfigured alias cycle must not loop forever."""
    assert resolve_model("A", {"A": "B", "B": "A"}) in {"A", "B"}


def test_resolved_model_maps_legacy_value(shortanswer_block_data):
    """A block saved with the legacy Claude id should resolve to the replacement."""
    legacy = ShortAnswerAIEvalXBlock(
        ToyRuntime(), DictFieldData({**shortanswer_block_data, "model": LEGACY_CLAUDE}), None
    )
    current = ShortAnswerAIEvalXBlock(
        ToyRuntime(),
        DictFieldData({**shortanswer_block_data, "model": SupportedModels.CLAUDE_SONNET.value}),
        None,
    )
    assert legacy.resolved_model == SupportedModels.CLAUDE_SONNET.value
    assert current.resolved_model == SupportedModels.CLAUDE_SONNET.value


def test_get_llm_response_calls_provider_with_resolved_model(shortanswer_block_data):
    """The provider call must use the resolved id, not the retired one stored on the block."""
    block = ShortAnswerAIEvalXBlock(
        ToyRuntime(),
        DictFieldData({**shortanswer_block_data, "model": LEGACY_CLAUDE, "model_api_key": "k"}),
        None,
    )
    with patch("ai_eval.base.get_llm_response", return_value=("ok", None)) as mock_llm, \
            patch("ai_eval.base.get_site_configuration_value", return_value=None):
        block.get_llm_response([{"role": "user", "content": "hi"}])
    assert mock_llm.call_args.args[0] == SupportedModels.CLAUDE_SONNET.value


def test_model_config_key_resolves_legacy_value(shortanswer_block_data):
    """Per-model API-key config lookups for a legacy id reuse the CLAUDE_SONNET key name."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    assert block._get_model_config_key(LEGACY_CLAUDE, "api_key") == "CLAUDE_SONNET_API_KEY"
    assert (
        block._get_model_config_key(SupportedModels.CLAUDE_SONNET.value, "api_key")
        == "CLAUDE_SONNET_API_KEY"
    )


def test_coach_legacy_model_still_matches_claude_branch(coach_block_data):
    """The Coach dummy-user-turn branch (slot-based) must still fire for legacy-configured blocks."""
    block = CoachAIEvalXBlock(
        ToyRuntime(), DictFieldData({**coach_block_data, "model": LEGACY_CLAUDE}), None
    )
    assert block._model_slot() == SupportedModels.CLAUDE_SONNET.name


def test_coach_claude_branch_fires_for_overridden_claude_model(coach_block_data):
    """An operator override of the Claude slot must still be detected as the Claude slot."""
    block = CoachAIEvalXBlock(
        ToyRuntime(), DictFieldData({**coach_block_data, "model": "claude-sonnet-4-7"}), None
    )
    with patch(
        "ai_eval.supported_models.get_site_configuration_value",
        side_effect=_fake_site_config({"CLAUDE_SONNET_MODEL": "claude-sonnet-4-7"}),
    ):
        assert block._model_slot() == SupportedModels.CLAUDE_SONNET.name


def test_effective_supported_models_applies_site_override(shortanswer_block_data):
    """A <NAME>_MODEL site setting replaces that slot's value in the model list/dropdown."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    with patch(
        "ai_eval.supported_models.get_site_configuration_value",
        side_effect=_fake_site_config({"CLAUDE_SONNET_MODEL": "claude-sonnet-4-7"}),
    ):
        models = block._effective_supported_models()
    assert "claude-sonnet-4-7" in models                       # override is offered
    assert SupportedModels.CLAUDE_SONNET.value not in models    # default is superseded
    assert SupportedModels.GPT4O.value in models                # untouched slots keep defaults


def test_overridden_model_keeps_stable_api_key_slot(shortanswer_block_data):
    """An overridden model id still maps back to its slot's API-key config key."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    with patch(
        "ai_eval.supported_models.get_site_configuration_value",
        side_effect=_fake_site_config({"CLAUDE_SONNET_MODEL": "claude-sonnet-4-7"}),
    ):
        assert block._get_model_config_key("claude-sonnet-4-7", "api_key") == "CLAUDE_SONNET_API_KEY"


def test_deprecated_models_setting_resolves_at_runtime(shortanswer_block_data):
    """A DEPRECATED_MODELS entry maps a saved id to its replacement with no code change."""
    block = ShortAnswerAIEvalXBlock(
        ToyRuntime(), DictFieldData({**shortanswer_block_data, "model": "retired-model-x"}), None
    )
    with patch(
        "ai_eval.supported_models.get_site_configuration_value",
        side_effect=_fake_site_config({"DEPRECATED_MODELS": {"retired-model-x": "gpt-4o"}}),
    ):
        assert block.resolved_model == "gpt-4o"


def test_override_cannot_hijack_another_slots_default_api_key(shortanswer_block_data):
    """An override equal to another slot's default id must not steal that slot's API-key key."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    with patch(
        "ai_eval.supported_models.get_site_configuration_value",
        side_effect=_fake_site_config({"GPT4O_MINI_MODEL": SupportedModels.GPT4O.value}),
    ):
        # "gpt-4o" is GPT4O's default; defaults win, so it maps to GPT4O, not GPT4O_MINI.
        assert block._get_model_config_key(SupportedModels.GPT4O.value, "api_key") == "GPT4O_API_KEY"


def test_model_maps_are_cached_per_instance(shortanswer_block_data):
    """Effective-model/alias maps are computed once; repeat reads don't re-hit site config."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    with patch("ai_eval.supported_models.get_site_configuration_value", return_value=None) as mock_cfg:
        _ = block.resolved_model             # builds + caches the maps
        reads_after_first = mock_cfg.call_count
        assert reads_after_first > 0          # it really did read site config once
        _ = block.resolved_model             # served from cache
        block._effective_supported_models()  # served from cache
        block._get_model_config_key(SupportedModels.GPT4O.value, "api_key")
        assert mock_cfg.call_count == reads_after_first  # no additional site-config reads


# --- index_dictionary (Studio / Meilisearch search indexing) ---


def test_shortanswer_index_dictionary(shortanswer_block_data):
    """Short Answer indexes only display name and question; secrets never leak."""
    shortanswer_block_data.update({
        "evaluation_prompt": "SECRET-RUBRIC do not leak",
        "model_api_key": "SECRET-MODEL-KEY",
        "question": "What is <b>gravity</b>?",
        "sessions": [[{"source": "user", "content": "SECRET-USER-STATE"}]],
    })
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)

    result = block.index_dictionary()

    assert result["content_type"] == "AI Short-Answer"
    assert result["content"]["display_name"] == "Short answer with AI Evaluation"
    # HTML embedded in the Markdown question is stripped for the index.
    assert result["content"]["question"] == "What is gravity ?"

    serialized = str(result)
    for secret in ("SECRET-RUBRIC", "SECRET-MODEL-KEY", "SECRET-USER-STATE", SupportedModels.GPT4O.value):
        assert secret not in serialized


def test_coding_index_dictionary(coding_block_data):
    """Coding indexes display name, question, and selected language; secrets never leak."""
    coding_block_data.update({
        "evaluation_prompt": "SECRET-RUBRIC do not leak",
        "model_api_key": "SECRET-MODEL-KEY",
        "judge0_api_key": "SECRET-JUDGE0-KEY",
        "sessions": [{
            "USER_RESPONSE": "SECRET-USER-CODE",
            "AI_EVALUATION": "SECRET-AI-EVALUATION",
            "CODE_EXEC_RESULT": {"stdout": "SECRET-STDOUT", "stderr": ""},
        }],
    })
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)

    result = block.index_dictionary()

    assert result["content_type"] == "AI Coding Evaluation"
    assert result["content"]["display_name"] == "Coding with AI Evaluation"
    assert result["content"]["question"] == "ca va?"
    # The single selected language value, not the SUPPORTED_LANGUAGE_MAP constant.
    assert result["content"]["language"] == LanguageLabels.Python

    serialized = str(result)
    for secret in (
        "SECRET-RUBRIC",
        "SECRET-MODEL-KEY",
        "SECRET-JUDGE0-KEY",
        "SECRET-USER-CODE",
        "SECRET-AI-EVALUATION",
        "SECRET-STDOUT",
        SupportedModels.GPT4O.value,
    ):
        assert secret not in serialized


def test_coach_index_dictionary(coach_block_data):
    """Coaching indexes titles, intro/initial messages, and character names/roles only."""
    coach_block_data.update({
        "evaluator_prompt": "SECRET-EVALUATOR-PROMPT",
        "character_1_prompt": "SECRET-CHARACTER-1-PROMPT",
        "character_2_prompt": "SECRET-CHARACTER-2-PROMPT",
        "model_api_key": "SECRET-MODEL-KEY",
        "scenario_data": {
            "case_details": "SECRET-CASE-DETAILS",
            "learning_objectives": ["SECRET-OBJECTIVE"],
            "evaluation_criteria": [{"name": "SECRET-CRITERION"}],
        },
        "conversation_format": "SECRET-CONVERSATION-FORMAT",
        "message_content_tag": "SECRET-CONTENT-TAG",
        "blacklist": ["SECRET-BLACKLIST-TERM"],
        "intro_text": "Welcome to the <em>clinic</em> case",
        "initial_message": "Hello, I am the patient",
        "coach_initial_message": "Hi, I am your coach",
        "workspace_title": "Consultation",
        "coach_title": "Your Coach",
        "sessions": [{
            "workspace_history": [{
                "character_index": 0,
                "user_message": "SECRET-LEARNER-MESSAGE",
                "character_message": "SECRET-CHARACTER-MESSAGE",
            }],
            "coach_history": [],
            "evaluation_fragments": [],
            "attempts_used": 1,
            "finished": True,
            "final_submission": "SECRET-FINAL-SUBMISSION",
            "final_evaluation_markdown": "SECRET-FINAL-EVALUATION",
        }],
    })
    block = CoachAIEvalXBlock(ToyRuntime(), DictFieldData(coach_block_data), None)

    result = block.index_dictionary()

    assert result["content_type"] == "AI Coach"
    assert result["content"]["display_name"] == "Coached AI Evaluation"
    # HTML embedded in the Markdown intro is stripped for the index.
    assert result["content"]["intro_text"] == "Welcome to the clinic case"
    assert result["content"]["initial_message"] == "Hello, I am the patient"
    assert result["content"]["coach_initial_message"] == "Hi, I am your coach"
    assert result["content"]["workspace_title"] == "Consultation"
    assert result["content"]["coach_title"] == "Your Coach"
    assert result["content"]["character_1_name"] == "Patient"
    assert result["content"]["character_1_role"] == "Patient"
    assert result["content"]["character_2_name"] == "Coach"
    assert result["content"]["character_2_role"] == "Coach"

    serialized = str(result)
    for secret in (
        "SECRET-EVALUATOR-PROMPT",
        "SECRET-CHARACTER-1-PROMPT",
        "SECRET-CHARACTER-2-PROMPT",
        "SECRET-MODEL-KEY",
        "SECRET-CASE-DETAILS",
        "SECRET-OBJECTIVE",
        "SECRET-CRITERION",
        "SECRET-CONVERSATION-FORMAT",
        "SECRET-CONTENT-TAG",
        "SECRET-BLACKLIST-TERM",
        "SECRET-LEARNER-MESSAGE",
        "SECRET-CHARACTER-MESSAGE",
        "SECRET-FINAL-SUBMISSION",
        "SECRET-FINAL-EVALUATION",
        SupportedModels.GPT4O.value,
    ):
        assert secret not in serialized
