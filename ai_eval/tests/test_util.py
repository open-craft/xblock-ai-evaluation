"""Tests for general utils."""
import time_machine

from ai_eval.utils import now, pretty_time, markdown_to_safe_html, strip_html_tags


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


def test_strip_html_hardening():
    """Script/style contents are dropped and markup edge cases are handled."""
    assert strip_html_tags('<script src="x.js">secret()</script>visible') == "visible"
    assert strip_html_tags("<style>.a{color:red}</style>styled") == "styled"
    assert strip_html_tags('<img alt="a > b">text') == "text"
    assert strip_html_tags("<p>foo</p><p>bar</p>") == "foo bar"
    assert strip_html_tags("see https://example.com <!-- hidden -->") == "see https://example.com"
    assert strip_html_tags(None) == ""
