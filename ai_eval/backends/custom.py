"""Custom service code execution backend."""

from typing import Dict, Any, Optional
import requests
from ai_eval.utils import SUPPORTED_LANGUAGE_MAP, LanguageLabels, DEFAULT_HTTP_TIMEOUT
from .base import CodeExecutionBackend


class CustomServiceBackend(CodeExecutionBackend):
    """
    Generic custom code execution backend.
    """
    def __init__(   # pylint: disable=too-many-positional-arguments
        self,
        submit_endpoint: str,
        results_endpoint: str,
        languages_endpoint: str,
        api_key: str = "",
        timeout: int = DEFAULT_HTTP_TIMEOUT,
        auth_header_name: str = "Authorization",
        auth_scheme: Optional[str] = "Bearer",
    ):
        self.submit_endpoint = submit_endpoint
        self.results_endpoint = results_endpoint
        self.languages_endpoint = languages_endpoint
        self.api_key = api_key
        self.timeout = timeout
        self.auth_header_name = auth_header_name
        self.auth_scheme = auth_scheme
        self._languages_validated = False

    def _get_headers(self) -> Dict[str, str]:
        """
        Get headers for API requests.
        """
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            if self.auth_scheme:
                headers[self.auth_header_name] = f"{self.auth_scheme} {self.api_key}"
            else:
                headers[self.auth_header_name] = self.api_key
        return headers

    def _validate_languages(self):
        """
        Validate that static languages are supported by the custom service.
        """
        try:
            response = requests.get(
                self.languages_endpoint,
                headers=self._get_headers(),
                timeout=self.timeout
            )
            response.raise_for_status()

            service_languages = response.json()
            # Expected format: [{"id": "92", "name": "Python"}, ...] or [{"id": "python", "name": "Python"}, ...]
            service_language_names = {lang['name'].lower() for lang in service_languages}

            static_language_names = {
                name.lower() for name in SUPPORTED_LANGUAGE_MAP
                if name != LanguageLabels.HTML_CSS
            }

            unsupported = static_language_names - service_language_names
            if unsupported:
                raise ValueError(
                    f"Custom service does not support languages: {', '.join(unsupported)}. "
                )

        except (requests.RequestException, KeyError, ValueError) as e:
            raise ValueError(f"Failed to validate supported languages: {e}") from e

    def _ensure_languages_validated(self):
        """
        Validate supported languages lazily once if an endpoint is configured.
        """
        if self._languages_validated:
            return
        if not self.languages_endpoint:
            self._languages_validated = True
            return
        self._validate_languages()
        self._languages_validated = True

    def submit_code(self, code: str, language_label: str) -> str:
        """
        Submit code to custom service for execution.
        """
        self._ensure_languages_validated()
        # By default, send the language label; services will need to map as needed
        payload = {
            'code': code,
            'language': language_label
        }

        try:
            response = requests.post(
                self.submit_endpoint,
                json=payload,
                headers=self._get_headers(),
                timeout=self.timeout
            )
            response.raise_for_status()

            # Handle different response formats
            result = response.json()
            if 'submission_id' in result:
                return result['submission_id']
            elif 'id' in result:
                return str(result['id'])
            else:
                raise ValueError("Custom service response missing submission ID")

        except requests.RequestException as e:
            raise ValueError(f"Failed to submit code for execution: {e}") from e
        except (KeyError, ValueError) as e:
            raise ValueError(f"Invalid response from custom service: {e}") from e

    def get_result(self, submission_id: str) -> Dict[str, Any]:
        """
        Get execution result from custom service.
        """
        self._ensure_languages_validated()
        url = self.results_endpoint.format(submission_id=submission_id)

        try:
            response = requests.get(
                url,
                headers=self._get_headers(),
                timeout=self.timeout
            )
            response.raise_for_status()

            result = response.json()

            # Map custom service response to standard format
            return {
                'status': {
                    'id': result.get('status_code', 3),
                    'description': result.get('status', 'Completed')
                },
                'stdout': result.get('stdout'),
                'stderr': result.get('stderr'),
                'compile_output': result.get('compile_error')
            }

        except requests.RequestException as e:
            raise ValueError(f"Failed to get submission result: {e}") from e
        except (KeyError, ValueError) as e:
            raise ValueError(f"Invalid response from custom service: {e}") from e
