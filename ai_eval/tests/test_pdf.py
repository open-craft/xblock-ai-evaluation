"""Tests for pdf related tooling."""

from ai_eval.pdf_generator import CoachedData, ShortAnswerData, CodingData


def test_coached_data_html_sanitize():
    """Test that markdown is converted to html and sanitized when loading into coach data."""
    data = CoachedData(
        **{
            "final_submission": "# final_submission\n<script>evil();</script><p class='foo'>hi</p>",
            "final_evaluation": (
                "I grade your submission <em style='color:red;'>F</em>, "
                "for you did not meet the _requirements_."
            ),
            "evaluator_name": "Trevor",
            "sections": [
                {
                    "kind": "workspace",
                    "messages": [
                        {
                            "kind": "workspace",
                            "avatar_url": "",
                            "name": "AI",
                            "time": None,
                            "content": "Hello _Dave_, how are you?<script>evil();</script>",
                        }
                    ],
                },
            ],
        }
    )

    assert data.final_submission == "<h1>final_submission</h1>\n<p>hi</p>\n\n"
    assert (
        data.final_evaluation
        == "<p>I grade your submission <em>F</em>, for you did not meet the <em>requirements</em>.</p>\n"
    )
    assert (
        data.sections[0].messages[0].content
        == "<p>Hello <em>Dave</em>, how are you?</p>\n"
    )


def test_shortanswer_data_html_sanitize():
    """Test that markdown is converted to html and sanitized when loading into shortanswer data."""
    data = ShortAnswerData(
        **{
            "messages": [
                {
                    "kind": "student",
                    "avatar_url": "",
                    "name": "Student",
                    "time": None,
                    "content": "Can I run <script>evil();</script> **scripts**?",
                }
            ]
        }
    )

    assert data.messages[0].content == "<p>Can I run  <strong>scripts</strong>?</p>\n"


def test_coding_data_html_sanitize():
    """Test that markdown is converted to html and sanitized when loading into coding data."""
    data = CodingData(
        **{
            "code": {
                "language": "python",
                "highlighted_code": "",
                "stdout": "",
                "stderr": "",
            },
            "feedback": "You forgot to <unknown>write</unknown> the _code_!",
            "time": None,
        }
    )

    assert data.feedback == "<p>You forgot to write the <em>code</em>!</p>\n"
