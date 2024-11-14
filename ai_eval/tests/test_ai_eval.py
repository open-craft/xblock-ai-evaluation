"""
Testing module.
"""
# pylint: disable=redefined-outer-name,protected-access

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
from ai_eval.llm import SupportedModels


@pytest.fixture
def coding_block_data():
    """Fixture for coding block test data."""
    return {
        "language": "Python",
        "question": "ca va?",
        "code": "",
        "ai_evaluation": "",
        "code_exec_result": {},
        "marked_html": '<!doctype html>\n<html lang="en">\n<head></head>\n<body>\n    <script '
        'type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked'
        '.min.js"></script>\n</body>\n</html>',
        "monaco_html": '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n'
        '  <title>Monaco Editor</title>\n</head>\n<body style="margin: 0;">\n  <div class="monaco"'
        ' style="width: 100vw; height: 100vh;"></div>\n  <script type="module">\n    import * as'
        ' monaco from "https://cdn.jsdelivr.net/npm/monaco-editor@0.49.0/+esm";\n\n    window.editor '
        '= monaco.editor.create(document.querySelector(".monaco"), {\n      language: "python",\n    '
        "  minimap: { enabled: false },\n      lineNumbersMinChars: 2,\n      folding: false,\n    });\n\n"
        "    window.parent.postMessage('__USAGE_ID_PLACEHOLDER__', '*');\n  </script>\n</body>\n</html>\n",
    }


@pytest.fixture
def shortanswer_block_data():
    """Fixture for short answer block test data."""
    return {
        "question": "ca va?",
        "messages": {"USER": [], "LLM": []},
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
    assert frag.json_init_args == shortanswer_block_data
    assert '<div class="shortanswer_block">' in frag.content


def test_shortanswer_reset_allowed(shortanswer_block_data):
    """Test the reset function when allowed."""
    data = {
        **shortanswer_block_data,
        "allow_reset": True,
        "messages": {"USER": ["Hello"], "LLM": ["Hello"]},
    }
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    block.reset.__wrapped__(block, data={})
    assert block.messages == {"USER": [], "LLM": []}


def test_shortanswer_reset_forbidden(shortanswer_block_data):
    """Test the reset function when forbidden."""
    data = {
        **shortanswer_block_data,
        "messages": {"USER": ["Hello"], "LLM": ["Hello"]},
    }
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    with pytest.raises(JsonHandlerError):
        block.reset.__wrapped__(block, data={})
    assert block.messages == {"USER": ["Hello"], "LLM": ["Hello"]}


def test_character_image(shortanswer_block_data):
    """Test the character image."""
    data = {
        **shortanswer_block_data,
        "character_image": "/static/image.jpg",
    }
    block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
    frag = block.student_view()
    assert '<img src="/static/image.jpg" />' in frag.content


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


@pytest.mark.parametrize(
    "xblock_key, site_config_key, settings_dict, expected_result",
    [
        # XBlock field is prioritized
        ("xblock-key", "site-config-key", {"GPT4O_API_KEY": "settings-key"}, "xblock-key"),
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

    This tests the core fallback logic which is also used for API URLs.
    """
    ai_eval_block.model_api_key = xblock_key
    ai_eval_block._get_settings = Mock(return_value=settings_dict)

    with patch("ai_eval.base.get_site_configuration_value", return_value=site_config_key) as mock_site_config:
        api_key = ai_eval_block.get_model_api_key()

        if not xblock_key:
            mock_site_config.assert_called_once_with(ai_eval_block.block_settings_key, "GPT4O_API_KEY")

    if not site_config_key and not xblock_key:
        ai_eval_block._get_settings.assert_called_once()
    else:
        ai_eval_block._get_settings.assert_not_called()

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
