"""
Testing module.
"""
# pylint: disable=redefined-outer-name,protected-access

import urllib.request
import io
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from xblock.exceptions import JsonHandlerError
from xblock.field_data import DictFieldData
from xblock.test.toy_runtime import ToyRuntime

from ai_eval import (
    CodingAIEvalXBlock,
    MultiAgentAIEvalXBlock,
    ShortAnswerAIEvalXBlock,
)
from ai_eval.base import AIEvalXBlock
from ai_eval.supported_models import SupportedModels
from ai_eval.llm_services import CustomLLMService
from ai_eval.backends.factory import BackendFactory
from ai_eval.backends.judge0 import Judge0Backend
from ai_eval.backends.custom import CustomServiceBackend
from ai_eval.utils import SUPPORTED_LANGUAGE_MAP, LanguageLabels


@pytest.fixture
def coding_block_data():
    """Fixture for coding block test data."""
    monaco_html = AIEvalXBlock.loader.render_django_template(
        "/templates/monaco.html",
        {
            "monaco_language": SUPPORTED_LANGUAGE_MAP[LanguageLabels.Python].monaco_id,
        },
    )
    return {
        "language": "Python (3.8.1)",
        "question": "ca va?",
        "code": "",
        "ai_evaluation": "",
        "code_exec_result": {},
        "marked_html": '<!doctype html>\n<html lang="en">\n<head></head>\n<body>\n    <script '
        'type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked'
        '.min.js"></script>\n</body>\n</html>',
        "monaco_html": monaco_html,
    }


@pytest.fixture
def shortanswer_block_data():
    """Fixture for short answer block test data."""
    return {
        "question": "ca va?",
        "sessions": [[{"source": "user", "content": "hi"}]],
        "max_responses": 3,
        "marked_html": (
            '<!doctype html>\n<html lang="en">\n<head></head>\n<body>\n'
            '    <script type="text/javascript" '
            'src="https://cdnjs.cloudflare.com'
            '/ajax/libs/marked/13.0.2/marked.min.js"></script>\n'
            "</body>\n</html>"
        ),
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
    frag = block.student_view()
    assert coding_block_data == frag.json_init_args
    assert '<div class="eval-ai-container">' in frag.content


def test_shortanswer_block_student_view(shortanswer_block_data):
    """Test the basic view loads for ShortAnswerAIEvalXBlock."""
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(shortanswer_block_data), None)
    frag = block.student_view()
    expected_args = shortanswer_block_data.copy()
    del expected_args["sessions"]
    expected_args["messages"] = shortanswer_block_data["sessions"][-1]
    assert frag.json_init_args == expected_args
    assert '<div class="shortanswer_block">' in frag.content


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
    frag = block.student_view()
    assert '<img src="/static/image.jpg" />' in frag.content


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


def test_multiagent_block_finished():
    """Test the MultiAgentAIEvalXBlock for not allowing input after finished."""
    data = {
        "finished": True
    }
    block = MultiAgentAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    with pytest.raises(JsonHandlerError):
        block.get_response.__wrapped__(block, data={})


def test_multiagent_block_force_finish():
    """Test force finish for the MultiAgentAIEvalXBlock."""
    data = {}
    block = MultiAgentAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    block._get_evaluator_response = Mock(return_value="evaluator response")
    resp = block.get_response.__wrapped__(block, data={"force_finish": True})
    assert resp["message"] == "evaluator response"
    assert resp["finished"]
    assert resp["is_evaluator"]


def test_multiagent_block_response():
    """Test regular response for the MultiAgentAIEvalXBlock."""
    data = {}
    block = MultiAgentAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    block._get_next_agent = Mock(return_value="Character")
    block._get_agent_response = Mock(return_value="agent response")
    block._get_character_data = Mock(return_value={"role": "role"})
    resp = block.get_response.__wrapped__(block, data={"user_input": "hi"})
    block._get_next_agent.assert_called_once_with("hi")
    block._get_agent_response.assert_called_once_with("Character", "hi")
    assert resp["message"] == "agent response"
    assert not resp["finished"]
    assert not resp["is_evaluator"]
    assert resp["role"] == "Character"
    assert resp["character_data"]["role"] == "role"


def test_multiagent_block_evaluator_response():
    """Test evaluator response for the MultiAgentAIEvalXBlock."""
    data = {}
    block = MultiAgentAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    block._get_next_agent = Mock(return_value="FINISH")
    block._get_evaluator_response = Mock(return_value="evaluator response")
    resp = block.get_response.__wrapped__(block, data={"user_input": "end"})
    block._get_next_agent.assert_called_once_with("end")
    block._get_evaluator_response.assert_called_once_with("end")
    assert resp["message"] == "evaluator response"
    assert resp["finished"]
    assert resp["is_evaluator"]


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
        payload = ai_eval_block._get_studio_lock_payload()
        assert payload["lock_model_api_key_initial"] is True


def test_studio_lock_payload_keeps_model_api_key_unlocked_without_config(ai_eval_block):
    """Studio payload should keep model API key editable without global/site config."""
    ai_eval_block._get_settings = Mock(return_value={})
    with patch("ai_eval.base.get_site_configuration_value", return_value=None):
        payload = ai_eval_block._get_studio_lock_payload()
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
        payload = block._get_studio_lock_payload()
        assert payload["lock_judge0_api_key"] is True


def test_coding_studio_lock_payload_unsets_judge0_lock_flag_without_runtime_key(coding_block_data):
    """Coding Studio payload should not lock judge0 field without runtime judge0 key."""
    block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(coding_block_data), None)
    block._get_settings = Mock(return_value={})
    with patch('ai_eval.coding_ai_eval.settings', new=SimpleNamespace()), \
            patch("ai_eval.base.get_site_configuration_value", return_value=None):
        payload = block._get_studio_lock_payload()
        assert payload["lock_judge0_api_key"] is False
