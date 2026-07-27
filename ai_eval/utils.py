"""
Utilities
"""

import html
from dataclasses import dataclass
from datetime import datetime, UTC

import mistune
import nh3

# These are fallback times to make it easier to work with and order old data that doesn't have times.
# coach messages should be displayed before workspace messages
# For any message with these times, the times should not be displayed to the user (because they're fake times).
FALLBACK_COACH_MESSAGE_TIME = datetime(1975, 1, 1, tzinfo=UTC).isoformat()
FALLBACK_WORKSPACE_MESSAGE_TIME = datetime(1976, 1, 1, tzinfo=UTC).isoformat()


def now() -> datetime:
    """Return a timezone aware datetime for the current instant, in the local timezone."""
    return datetime.now().astimezone()


def pretty_time(value: datetime) -> str:
    """
    Jinja filter to get a human readable date with a consistent format.

    This is used to display date values in the PDFs.
    """
    # See https://docs.python.org/3/library/datetime.html#strftime-and-strptime-format-codes for formatting help.
    return value.strftime("%d %B %Y, %I:%M%p %Z")


# TODO: The frontend uses dompurify and marked frontend/src/shared/renderMarkdown.ts;
# we may wish to consolidate markdown rendering and html cleaning to the backend, and remove it from the frontend.
def markdown_to_safe_html(markdown_content: str) -> str:
    """
    Convert untrusted markdown to safe html, for outputting to PDF with Weasyprint.
    """
    html_content = mistune.html(markdown_content)
    # docs: https://nh3.readthedocs.io/en/latest/
    # Disable links and images, to avoid privacy or security issues
    # (eg. malicious links, large images causing a DOS attack).
    return nh3.clean(html_content, tags=nh3.ALLOWED_TAGS - {"a", "img"})


def strip_html_tags(text: str) -> str:
    """Reduce HTML to searchable plain text; script/style contents are dropped."""
    text = (text or "").replace("<", " <")
    return " ".join(html.unescape(nh3.clean(text, tags=set())).split())


# Default timeout (in seconds) for outbound HTTP requests.
# Adjust here to change the global default behavior.
DEFAULT_HTTP_TIMEOUT = 30


@dataclass
class ProgrammimgLanguage:
    """A programming language."""

    monaco_id: str
    judge0_id: int


class LanguageLabels:
    """Language labels as seen by users."""

    Python = "Python (3.8.1)"
    JavaScript = "JavaScript (Node.js 12.14.0)"
    Java = "Java (OpenJDK 13.0.1)"
    CPP = "C++ (GCC 9.2.0)"
    HTML_CSS = "HTML/CSS"


# supported programming languages and their IDs in judge0 and monaco
# https://ce.judge0.com/#statuses-and-languages-active-and-archived-languages
# Before adding languages,
# check the monaco_id is also in the list of short names for Pygments https://pygments.org/languages/
# (used by the PDF generator).
SUPPORTED_LANGUAGE_MAP = {
    LanguageLabels.Python: ProgrammimgLanguage(
        monaco_id="python", judge0_id=92
    ),  # Python (3.11.2)
    LanguageLabels.JavaScript: ProgrammimgLanguage(
        monaco_id="javascript", judge0_id=93
    ),  # JavaScript (Node.js 18.15.0)
    LanguageLabels.Java: ProgrammimgLanguage(
        monaco_id="java", judge0_id=91
    ),  # Java (JDK 17.0.6)
    LanguageLabels.CPP: ProgrammimgLanguage(
        monaco_id="cpp", judge0_id=54
    ),  # C++ (GCC 9.2.0)
    # Monaco's HTML support includes CSS support within the 'style' tag.
    LanguageLabels.HTML_CSS: ProgrammimgLanguage(
        monaco_id="html", judge0_id=-1
    ),  # no exec
    }
