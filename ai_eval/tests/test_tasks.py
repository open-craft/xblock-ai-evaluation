"""Tests for export-task helpers."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

from ai_eval import coding_ai_eval, CodingAIEvalXBlock, ShortAnswerAIEvalXBlock
from ai_eval.tasks import _BASE_HEADER, _get_coach_export_sessions, _get_messages, _iter_coach_messages


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
    """Untimed Coaching fragments keep the workspace, coach, then evaluator order."""
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
        ("user", "workspace answer", "", ""),
        ("llm (Patient)", "workspace reply", "", ""),
        ("user", "coach question", "", ""),
        ("llm (Coach)", "coach reply", "", ""),
        ("llm (Evaluator)", "# Evaluation Report", "", ""),
    ]


def test_export_header_ends_with_timestamp_and_attachments():
    """New columns are appended last so existing column positions are unchanged."""
    assert _BASE_HEADER[-4:] == ("Source", "Message", "Timestamp", "Attachments")


def test_iter_coach_messages_includes_fragment_time():
    """Both messages of a Coaching fragment share the fragment's stored time."""
    block = SimpleNamespace(character_1_role="Patient", character_2_role="Coach")
    session = {
        "workspace_history": [{
            "character_index": 0,
            "user_message": "workspace answer",
            "character_message": "workspace reply",
            "time": "2026-09-01T10:00:00+00:00",
        }],
        "coach_history": [{
            "character_index": 1,
            "user_message": "coach question",
            "character_message": "coach reply",
            "time": "2026-09-01T10:05:00+00:00",
        }],
        "evaluation_fragments": [{
            "character_index": 0,
            "user_message": "",
            "character_message": "# Evaluation Report",
            "is_evaluation": True,
            "time": "2026-09-01T10:10:00+00:00",
        }],
    }

    assert list(_iter_coach_messages(block, session)) == [
        ("user", "workspace answer", "2026-09-01T10:00:00+00:00", ""),
        ("llm (Patient)", "workspace reply", "2026-09-01T10:00:00+00:00", ""),
        ("user", "coach question", "2026-09-01T10:05:00+00:00", ""),
        ("llm (Coach)", "coach reply", "2026-09-01T10:05:00+00:00", ""),
        ("llm (Evaluator)", "# Evaluation Report", "2026-09-01T10:10:00+00:00", ""),
    ]


def test_get_messages_shortanswer_includes_per_message_time():
    """Short Answer messages each carry their own time; older messages export a blank time."""
    block = Mock(spec=ShortAnswerAIEvalXBlock)
    session = [
        {"source": "user", "content": "old answer"},
        {"source": "user", "content": "answer", "time": "2026-09-01T10:00:00+00:00"},
        {"source": "llm", "content": "feedback", "time": "2026-09-01T10:00:07+00:00"},
    ]

    assert list(_get_messages(block, session)) == [
        ("user", "old answer", "", ""),
        ("user", "answer", "2026-09-01T10:00:00+00:00", ""),
        ("llm", "feedback", "2026-09-01T10:00:07+00:00", ""),
    ]


def test_get_messages_coding_uses_session_time():
    """All rows of a Coding submission share the submission time."""
    block = Mock(spec=CodingAIEvalXBlock)
    session = {
        coding_ai_eval.USER_RESPONSE: "print(1)",
        coding_ai_eval.AI_EVALUATION: "Looks good",
        coding_ai_eval.CODE_EXEC_RESULT: {"stdout": "1", "stderr": ""},
        coding_ai_eval.TIME: "2026-09-01T10:00:00+00:00",
    }

    assert [row[2] for row in _get_messages(block, session)] == ["2026-09-01T10:00:00+00:00"] * 3


def test_iter_coach_messages_puts_untimed_fragments_first():
    """Fragments recorded before timestamps existed come before timed ones."""
    block = SimpleNamespace(character_1_role="Patient", character_2_role="Coach")
    session = {
        "workspace_history": [
            {"user_message": "old", "character_message": "old reply"},
            {"user_message": "new", "character_message": "new reply", "time": "2026-09-01T10:05:00+00:00"},
        ],
        "coach_history": [
            {"user_message": "old coach", "character_message": "old coach reply"},
        ],
        "evaluation_fragments": [],
    }

    assert [row[1] for row in _iter_coach_messages(block, session)] == [
        "old", "old reply", "old coach", "old coach reply", "new", "new reply",
    ]


NOTES_ATTACHMENT = {"upload_id": "1b9e", "filename": "notes.txt", "content_type": "text/plain"}
REPORT_ATTACHMENT = {"upload_id": "2c0f", "filename": "report.pdf", "content_type": "application/pdf"}


def test_csv_export_attachments_column_all_block_types():
    """Learner rows list their attached filenames; every other row, and every Coding row, has an empty cell."""
    shortanswer_session = [
        {"source": "user", "content": "answer", "attachments": [NOTES_ATTACHMENT, REPORT_ATTACHMENT]},
        {"source": "llm", "content": "feedback"},
    ]
    coding_session = {
        coding_ai_eval.USER_RESPONSE: "print(1)",
        coding_ai_eval.AI_EVALUATION: "Looks good",
        coding_ai_eval.CODE_EXEC_RESULT: {"stdout": "1", "stderr": ""},
    }
    coach_session = {
        "workspace_history": [{
            "user_message": "answer", "character_message": "reply", "attachments": [NOTES_ATTACHMENT],
        }],
        "coach_history": [],
        "evaluation_fragments": [],
    }
    coach_block = SimpleNamespace(character_1_role="Patient", character_2_role="Coach")

    shortanswer_rows = list(_get_messages(Mock(spec=ShortAnswerAIEvalXBlock), shortanswer_session))
    coding_rows = list(_get_messages(Mock(spec=CodingAIEvalXBlock), coding_session))
    coach_rows = list(_iter_coach_messages(coach_block, coach_session))

    assert [row[3] for row in shortanswer_rows] == ["notes.txt, report.pdf", ""]
    assert [row[3] for row in coding_rows] == ["", "", ""]
    assert [row[3] for row in coach_rows] == ["notes.txt", ""]


def test_csv_export_includes_file_only_user_rows():
    """A Coaching message with files but no text still gets a learner row."""
    block = SimpleNamespace(character_1_role="Patient", character_2_role="Coach")
    session = {
        "workspace_history": [],
        "coach_history": [
            {"user_message": "", "character_message": "coach reply", "attachments": [REPORT_ATTACHMENT]},
            {"user_message": "", "character_message": "legacy empty message"},
        ],
        "evaluation_fragments": [],
    }

    assert list(_iter_coach_messages(block, session)) == [
        ("user", "", "", "report.pdf"),
        ("llm (Coach)", "coach reply", "", ""),
        ("llm (Coach)", "legacy empty message", "", ""),
    ]
