"""
Utilities
"""

from dataclasses import dataclass
import requests
from .compat import get_site_configuration_value


@dataclass
class ProgrammimgLanguage:
    """A programming language."""

    monaco_id: str
    judge0_id: int


class LanguageLabels:
    """Language labels as seen by users."""

    Python = "Python"
    JavaScript = "JavaScript"
    Java = "Java"
    CPP = "C++"
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


JUDGE0_BASE_CE_URL = "https://judge0-ce.p.rapidapi.com"


def _get_judge0_base_url() -> str:
    """
    Get the base URL for Judge0 API from site configuration.
    """
    return get_site_configuration_value("ai_eval", "JUDGE0_BASE_URL") or JUDGE0_BASE_CE_URL


def get_supported_language_map() -> dict[str, ProgrammimgLanguage]:
    """
    Get the mapping of supported programming languages to their IDs in Judge0 and Monaco.

    Returns:
        A dictionary mapping language labels to their corresponding ProgrammimgLanguage objects.
    """

    # Try to get the supported languages from site configuration
    custom_languages = get_site_configuration_value("ai_eval", "SUPPORTED_LANGUAGES")
    if custom_languages:
        return {
            lang: ProgrammimgLanguage(
                monaco_id=lang_data["monaco_id"],
                judge0_id=lang_data["judge0_id"]
            )
            for lang, lang_data in custom_languages.items()
        }

    # Fallback to the default supported languages
    return SUPPORTED_LANGUAGE_MAP


def submit_code(api_key: str, code: str, language: str) -> str:
    """
    Submit code to the judge0 API.
    """
    base_url = _get_judge0_base_url()
    url = f"{base_url}/submissions?base64_encoded=false&wait=false"
    headers = {"content-type": "application/json", "x-rapidapi-key": api_key}

    supported_languages = get_supported_language_map()
    data = {
        "source_code": code,
        "language_id": supported_languages[language].judge0_id,
    }

    response = requests.post(url, headers=headers, json=data, timeout=10)
    response.raise_for_status()
    result = response.json()
    sub_id = result["token"]

    return sub_id


def get_submission_result(api_key: str, submission_id: str):
    """
    Get result from Judge0 submission.
    """
    base_url = _get_judge0_base_url()
    url = f"{base_url}/submissions/{submission_id}?base64_encoded=false&fields=*"
    headers = {"content-type": "application/json", "x-rapidapi-key": api_key}

    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()
    result = response.json()

    return result
