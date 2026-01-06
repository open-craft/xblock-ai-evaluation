"""Judge0 code execution backend."""

import logging
from typing import Any, Dict

import requests

from ai_eval.utils import DEFAULT_HTTP_TIMEOUT, SUPPORTED_LANGUAGE_MAP

from .base import CodeExecutionBackend


logger = logging.getLogger(__name__)


class Judge0Backend(CodeExecutionBackend):
    """
    Judge0 code execution backend.
    """

    def __init__(self, api_key: str = "", base_url: str = None):
        self.api_key = api_key
        self.base_url = base_url or "https://judge0-ce.p.rapidapi.com"
        self._language_cache: Dict[str, int] | None = None

    def _build_headers(self, include_content_type: bool = False) -> Dict[str, str]:
        """
        Build required headers for request.
        """
        headers: Dict[str, str] = {}
        if include_content_type:
            headers["content-type"] = "application/json"
        if self.api_key:
            headers["x-rapidapi-key"] = self.api_key
        return headers

    def _load_languages(self) -> Dict[str, int]:
        """
        Load languages cache.
        """
        if self._language_cache is not None:
            return self._language_cache

        url = f"{self.base_url}/languages"
        headers = self._build_headers()
        try:
            response = requests.get(
                url,
                headers=headers,
                timeout=DEFAULT_HTTP_TIMEOUT,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning(
                "Unable to fetch Judge0 languages from %s: %s", url, exc
            )
            self._language_cache = {}
            return self._language_cache

        languages: Dict[str, int] = {}
        if isinstance(payload, list):
            for entry in payload:
                try:
                    name = str(entry["name"]).strip()
                    language_id = int(entry["id"])
                except (KeyError, TypeError, ValueError):
                    continue
                languages[name] = language_id
        else:
            logger.warning(
                "Unexpected language payload from Judge0 at %s: %s", url, payload
            )

        self._language_cache = languages
        return self._language_cache

    def _get_language_id(self, language_label: str) -> int:
        """
        Return the corresponding language id.
        """
        try:
            language_config = SUPPORTED_LANGUAGE_MAP[language_label]
        except KeyError as exc:
            raise ValueError(f"Unsupported language: {language_label}") from exc

        language_map = self._load_languages()

        if language_label in language_map:
            return language_map[language_label]

        logger.debug(
            "Falling back to static Judge0 language ID for %s", language_label
        )
        return int(language_config.judge0_id)

    def submit_code(self, code: str, language_label: str) -> str:
        """
        Submit code to Judge0 for execution.
        """
        if not self.api_key:
            raise ValueError("Judge0 API key is required")

        # Map the human-readable label to Judge0 numeric id
        judge0_id = self._get_language_id(language_label)

        url = f"{self.base_url}/submissions"
        headers = self._build_headers(include_content_type=True)
        payload = {
            'source_code': code,
            'language_id': int(judge0_id)
        }

        try:
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=DEFAULT_HTTP_TIMEOUT,
            )
            response.raise_for_status()

            result = response.json()
            if 'token' in result:
                return result['token']
            else:
                raise ValueError("Judge0 response missing submission token")

        except requests.RequestException as e:
            raise ValueError(f"Failed to submit code to Judge0: {e}") from e
        except (KeyError, ValueError) as e:
            raise ValueError(f"Invalid response from Judge0: {e}") from e

    def get_result(self, submission_id: str) -> Dict[str, Any]:
        """
        Get execution result from Judge0.
        """
        if not self.api_key:
            raise ValueError("Judge0 API key is required")

        url = f"{self.base_url}/submissions/{submission_id}"
        headers = self._build_headers()

        try:
            response = requests.get(
                url,
                headers=headers,
                timeout=DEFAULT_HTTP_TIMEOUT,
            )
            response.raise_for_status()

            return response.json()

        except requests.RequestException as e:
            raise ValueError(f"Failed to get submission result from Judge0: {e}") from e
        except (KeyError, ValueError) as e:
            raise ValueError(f"Invalid response from Judge0: {e}") from e
