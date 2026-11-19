"""Appearance settings must not change the existing short-answer behavior."""
# pylint: disable=redefined-outer-name,protected-access
from unittest.mock import Mock, patch

import pytest
from xblock.field_data import DictFieldData

from ai_eval import ShortAnswerAIEvalXBlock
from ai_eval.supported_models import SupportedModels
from ai_eval.tests.xblock_fakes import ToyRuntime, learner_scope_ids


@pytest.fixture
def block():
    """A configured block with no persisted appearance settings (legacy content)."""
    instance = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData({
        "question": "A question",
        "model": SupportedModels.GPT4O.value,
        "model_api_key": "test-key",
        "sessions": [[{"source": "user", "content": "An existing answer"}]],
    }), learner_scope_ids("shortanswer"))
    instance._get_attachments = Mock(return_value=[])
    service = Mock()
    service.get_available_models.return_value = [SupportedModels.GPT4O.value]
    with patch("ai_eval.base.get_site_configuration_value", return_value=None), \
            patch("ai_eval.base.get_llm_service", return_value=service), \
            patch.object(instance.runtime, "handler_url", side_effect=lambda _, name: f"/handler/{name}"):
        yield instance


def save(block, **updates):
    """Submit the complete current Studio payload with selected edits."""
    return block.studio_submit.__wrapped__(block, {**block._studio_initial_state(), **updates})


@pytest.mark.parametrize("view", ["student_view", "author_view"])
def test_legacy_appearance_defaults(block, view):
    """Existing blocks gain a default background without losing state or title."""
    meta = getattr(block, view)().json_init_args["meta"]
    # show_display_name defaults to False, so the title is blank and the React
    # header falls back to the localized "AI Discussion" default.
    assert meta["title"] == ""
    assert meta["background_theme"] == "default"
    assert block.display_name == "AI Discussion"
    assert block.sessions == [[{"source": "user", "content": "An existing answer"}]]


@pytest.mark.parametrize("background", ShortAnswerAIEvalXBlock.BACKGROUND_THEMES)
def test_appearance_studio_roundtrip(block, background):
    """Every thumbnail key and the display name persist and reach both views."""
    response = save(block, display_name="My discussion", show_display_name=True, background_theme=background)
    assert response["success"] is True
    assert block._studio_initial_state()["display_name"] == "My discussion"
    assert block._studio_initial_state()["background_theme"] == background
    for view in (block.student_view, block.author_view):
        meta = view().json_init_args["meta"]
        assert meta["title"] == "My discussion"
        assert meta["background_theme"] == background
    assert save(block, background_theme="default")["success"] is True
    assert block.background_theme == "default"


@pytest.mark.parametrize("show_display_name", [False, True])
@pytest.mark.parametrize("hide_question", [False, True])
def test_title_gated_by_show_display_name(block, show_display_name, hide_question):
    """The header title is the display name only when show_display_name is on."""
    block.show_display_name = show_display_name
    block.hide_question = hide_question
    block.display_name = "New title"
    meta = block.student_view().json_init_args["meta"]
    assert meta["title"] == ("New title" if show_display_name else "")
    assert meta["hide_question"] is hide_question


@pytest.mark.parametrize("display_name", ["", "   ", "<b>Plain text only</b>"])
def test_display_name_roundtrip(block, display_name):
    """A shown title may be blank (frontend falls back) or contain literal markup."""
    block.show_display_name = True
    assert save(block, display_name=display_name)["success"] is True
    assert block.student_view().json_init_args["meta"]["title"] == display_name


@pytest.mark.parametrize("value", ["", "removed", "#ffffff", "var(--arbitrary)", "url(https://example.com)"])
def test_rejects_unknown_background_without_partial_save(block, value):
    """Only known theme keys may be stored; callers cannot inject arbitrary CSS."""
    response = save(block, display_name="Should not save", background_theme=value)
    assert response["success"] is False
    assert "background_theme" in response["validation_errors"]
    assert block.display_name == "AI Discussion"
    assert block.background_theme == "default"


def test_omitting_background_rejects_and_preserves_stored_value(block):
    """A payload without background_theme is rejected; the stored value is unchanged."""
    block.background_theme = "navy"
    values = block._studio_initial_state()
    del values["background_theme"]
    response = block.studio_submit.__wrapped__(block, values)
    assert response["success"] is False
    assert response["validation_errors"] == {"background_theme": ["Missing field in Studio payload."]}
    assert block.background_theme == "navy"


@pytest.mark.django_db  # Reset deletes the learner's pending uploads.
def test_reset_preserves_appearance_and_old_sessions(block):
    """The existing reset remains a session boundary, not a settings reset."""
    block.display_name = "Keep title"
    block.show_display_name = True
    block.background_theme = "blue"
    block.allow_reset = True
    block.thread_map = {"provider:model:tag": "thread"}
    block.reset.__wrapped__(block, {})
    assert block.sessions == [[{"source": "user", "content": "An existing answer"}], []]
    assert block.thread_map == {}
    assert block.display_name == "Keep title"
    assert block.show_display_name is True
    assert block.background_theme == "blue"
