"""Tests for general utils."""
import time_machine

from ai_eval.utils import now, pretty_time, markdown_to_safe_html


@time_machine.travel("2000-01-01T05:30Z", tick=False)
def test_now():
    """Test the convenience 'now' function."""
    assert now().isoformat() == "2000-01-01T05:30:00+00:00"


@time_machine.travel("2000-01-01T05:30Z", tick=False)
def test_pretty_time():
    """Test the jinja pretty-print time filter."""
    assert pretty_time(now()) == "01 January 2000, 05:30AM UTC"


def test_markdown_to_safe_html():
    """Test markdown is safely converted to html"""
    evil_input = '# hello\n<script>evil();</script><p class="bad">who, me?</p>\n\nhello _world_'
    safe_output = '<h1>hello</h1>\n<p>who, me?</p>\n\n<p>hello <em>world</em></p>\n'

    assert markdown_to_safe_html(evil_input) == safe_output
