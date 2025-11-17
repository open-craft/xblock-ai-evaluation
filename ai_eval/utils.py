"""
Utilities
"""

from dataclasses import dataclass


# Default timeout (in seconds) for outbound HTTP requests made by backends.
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
