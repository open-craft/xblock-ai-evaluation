"""Tests for export-task helpers."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

from ai_eval.tasks import _get_coach_export_sessions, _iter_coach_messages


def test_get_coach_export_sessions_prefers_sessions():
    """Coaching export should use sessions when the field is present."""
    expected_sessions = [{
        "workspace_history": [{
            "character_index": 0,
            "user_message": "answer",
            "character_message": "reply",
        }],
        "coach_history": [],
        "evaluation_fragments": [],
    }]
    mock_get_state = Mock(
        side_effect=lambda *_args, **_kwargs: expected_sessions
        if _args[3] == "sessions"
        else (_ for _ in ()).throw(AssertionError("older-state fields should not be queried"))
    )

    with patch("ai_eval.tasks._get_user_state_value", mock_get_state):
        result = _get_coach_export_sessions(Mock(), Mock(), Mock())

    assert result == expected_sessions
    mock_get_state.assert_called_once()


def test_get_coach_export_sessions_falls_back_to_older_state_fields():
    """Coaching export should synthesize one session from older learner data."""
    workspace_history = [{
        "character_index": 0,
        "user_message": "answer",
        "character_message": "reply",
    }]
    coach_history = [{
        "character_index": 1,
        "user_message": "help",
        "character_message": "coach reply",
    }]
    evaluation_fragments = [{
        "character_index": 0,
        "user_message": "",
        "character_message": "# Evaluation Report",
        "is_evaluation": True,
    }]
    values = {
        "sessions": None,
        "workspace_history": workspace_history,
        "coach_history": coach_history,
        "evaluation_fragments": evaluation_fragments,
    }

    with patch(
        "ai_eval.tasks._get_user_state_value",
        side_effect=lambda *_args, **_kwargs: values[_args[3]],
    ):
        result = _get_coach_export_sessions(Mock(), Mock(), Mock())

    assert result == [{
        "workspace_history": workspace_history,
        "coach_history": coach_history,
        "evaluation_fragments": evaluation_fragments,
    }]


def test_get_coach_export_sessions_does_not_fallback_when_sessions_field_exists():
    """Older-state fallback should not run once Coaching sessions exist."""
    values = {
        "sessions": [],
        "workspace_history": [{
            "character_index": 0,
            "user_message": "previous answer",
            "character_message": "previous reply",
        }],
        "coach_history": [],
        "evaluation_fragments": [],
    }

    with patch(
        "ai_eval.tasks._get_user_state_value",
        side_effect=lambda *_args, **_kwargs: values[_args[3]],
    ):
        result = _get_coach_export_sessions(Mock(), Mock(), Mock())

    assert not result


def test_iter_coach_messages_preserves_coaching_export_order():
    """Coaching export should emit workspace, coach, then evaluator messages."""
    block = SimpleNamespace(
        character_1_role="Patient",
        character_2_role="Coach",
    )
    session = {
        "workspace_history": [{
            "character_index": 0,
            "user_message": "workspace answer",
            "character_message": "workspace reply",
        }],
        "coach_history": [{
            "character_index": 1,
            "user_message": "coach question",
            "character_message": "coach reply",
        }],
        "evaluation_fragments": [{
            "character_index": 0,
            "user_message": "",
            "character_message": "# Evaluation Report",
            "is_evaluation": True,
        }],
    }

    assert list(_iter_coach_messages(block, session)) == [
        ("user", "workspace answer"),
        ("llm (Patient)", "workspace reply"),
        ("user", "coach question"),
        ("llm (Coach)", "coach reply"),
        ("llm (Evaluator)", "# Evaluation Report"),
    ]
