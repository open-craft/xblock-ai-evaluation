"""LLM Services Module"""

import logging
import time
import requests

from litellm import completion
from .supported_models import SupportedModels
from .compat import get_site_configuration_value

logger = logging.getLogger(__name__)

DEFAULT_TOKEN_EXPIRES_IN = 3300

TIMEOUT_ERROR_MESSAGE = "We're sorry, but the connection timed out. Please try that request again."


class LLMServiceBase:
    """
    Base class for llm service.
    """
    # pylint: disable=too-many-positional-arguments
    def get_response(self, model, api_key, messages, api_base, thread_id=None):
        """
        Get a response from the provider.

        Args:
            model (str): Model identifier.
            api_key (str): API key (for default providers or passthrough).
            messages (list[dict]): Chat messages.
            api_base (str|None): Optional base URL (e.g., for llama/ollama).
            thread_id (str|None): Optional provider-side conversation/thread id.

        Returns:
            tuple[str, str|None]: (response_text, optional_thread_id)
        """
        raise NotImplementedError

    def start_thread(self, model, api_key, messages, api_base):
        """
        Start a new provider-side thread and return its first response.

        Return the provider-issued conversation/thread id if available.

        Returns:
            tuple[str, str|None]: (response_text, new_thread_id)
        """
        raise NotImplementedError

    def get_available_models(self):
        raise NotImplementedError

    def supports_threads(self) -> bool:
        """
        Check if this service supports provider-side threads.

        Default is False; custom services can override to be flag-driven.
        """
        return False


# pylint: disable=abstract-method
class DefaultLLMService(LLMServiceBase):
    """
    Default llm service.
    """
    # pylint: disable=too-many-positional-arguments
    def get_response(
            self,
            model,
            api_key,
            messages,
            api_base,
            thread_id=None,
    ):
        kwargs = {}
        if api_base:
            kwargs["api_base"] = api_base
        try:
            text = (
                completion(model=model, api_key=api_key, messages=messages, **kwargs)
                .choices[0]
                .message.content
            )
            return text, None
        except Exception as e:
            if "timeout" in str(e).lower():
                raise Exception(TIMEOUT_ERROR_MESSAGE) from e
            raise

    def get_available_models(self):
        return [str(m.value) for m in SupportedModels]

    def supports_threads(self) -> bool:  # pragma: nocover - default is stateless
        return False


# pylint: disable=abstract-method
class CustomLLMService(LLMServiceBase):
    """
    Custom llm service.
    """
    # pylint: disable=too-many-positional-arguments
    def __init__(self, models_url, completions_url, token_url, client_id, client_secret):
        self.models_url = models_url
        self.completions_url = completions_url
        self.token_url = token_url
        self.client_id = client_id
        self.client_secret = client_secret
        self._access_token = None
        self._expires_at = 0

    def _fetch_token(self):  # pylint: disable=missing-function-docstring
        data = {
            'grant_type': 'client_credentials',
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'scope': 'ml.chatbot.query'
        }
        headers = {'Content-Type': 'application/x-www-form-urlencoded'}
        response = requests.post(self.token_url, data=data, headers=headers, timeout=30)
        response.raise_for_status()
        token_data = response.json()
        self._access_token = token_data['access_token']
        expires_in = token_data.get('expires_in')
        if expires_in:
            self._expires_at = time.time() + expires_in - 60
        else:
            self._expires_at = time.time() + DEFAULT_TOKEN_EXPIRES_IN

    def _ensure_token(self):
        if not self._access_token or time.time() >= self._expires_at:
            self._fetch_token()

    def _get_headers(self):
        self._ensure_token()
        return {'Authorization': f'Bearer {self._access_token}'}

    @staticmethod
    def _parse_models_field(raw_models):
        """
        Parse the value of a top-level "models" field into a list of model ids/names.
        """
        if isinstance(raw_models, list):
            return [str(m) for m in raw_models]
        if isinstance(raw_models, str):
            return [str(raw_models)]
        if isinstance(raw_models, dict):
            parsed_models = []
            for key, val in raw_models.items():
                if isinstance(val, dict):
                    candidate = val.get("name") or val.get("id") or key
                elif isinstance(val, str) and val.strip():
                    candidate = val
                else:
                    candidate = key
                parsed_models.append(str(candidate))
            return parsed_models
        return []

    @classmethod
    def _parse_models_response(cls, data):
        """
        Parse a models endpoint JSON response into a list of model ids/names.
        """
        if isinstance(data, dict):
            if "models" in data:
                return cls._parse_models_field(data["models"])
            if isinstance(data.get("data"), list):
                return [str(m.get("id", str(m))) for m in data["data"]]
            return []
        if isinstance(data, list):
            return [str(m) for m in data]
        if isinstance(data, str):
            return [str(data)]
        return []

    def get_response(
            self,
            model,
            api_key,
            messages,
            api_base,
            thread_id=None,
    ):
        """
        Send completion request to custom LLM endpoint.
        If thread_id is provided, include it and send only the latest user input.
        If thread_id is None, send full context and return (text, None).
        """
        url = self.completions_url
        # When reusing an existing thread, only send the latest user input and rely on
        # the provider to apply prior context associated with the conversation_id.
        if thread_id:
            latest_user = None
            for msg in reversed(messages):
                if (msg.get('role') or '').lower() == 'user':
                    latest_user = msg.get('content', '').strip()
                    break
            prompt = f"User: {latest_user}" if latest_user is not None else ""
        else:
            prompt = " ".join(
                f"{msg.get('role', '').capitalize()}: {msg.get('content', '').strip()}"
                for msg in messages
            )
        # Adjust the payload structure based on custom API requirements
        prompt = " ".join(
            f"{msg.get('role', '').capitalize()}: {msg.get('content', '').strip()}"
            for msg in messages
        )
        payload = {
            "model": str(model),
            "prompt": prompt,
        }
        try:
            response = requests.post(url, json=payload, headers=self._get_headers(), timeout=10)
            response.raise_for_status()
            data = response.json()
            text = data.get("response")
            new_thread_id = data.get("conversation_id")
            if not new_thread_id and isinstance(data.get("data"), dict):
                new_thread_id = data["data"].get("conversation_id")
            return text, new_thread_id
        except requests.exceptions.Timeout:
            raise Exception(TIMEOUT_ERROR_MESSAGE)  # pylint: disable=raise-missing-from

    def get_available_models(self):
        url = self.models_url
        try:
            if not url:
                logger.warning("CUSTOM_LLM_MODELS_URL not configured")
                return []

            response = requests.get(url, headers=self._get_headers(), timeout=30)
            response.raise_for_status()
            data = response.json()

            models = self._parse_models_response(data)

            # Filter out non-string model names and empty strings
            models = [m for m in models if isinstance(m, str) and m.strip()]

            if not models:
                logger.warning("No valid models found in custom service response")

            return models

        except requests.exceptions.Timeout:
            logger.error("Timeout fetching models from custom LLM service")
            return []
        except requests.exceptions.ConnectionError:
            logger.error("Connection error fetching models from custom LLM service")
            return []
        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error fetching models: {e}")
            return []
        except ValueError as e:
            logger.error(f"Invalid JSON response from custom LLM service: {e}")
            return []
        except Exception as e:  # pylint: disable=broad-exception-caught
            logger.error(
                f"Unexpected error fetching models from custom LLM service: {e}",
                exc_info=True,
            )
            return []

    def supports_threads(self) -> bool:
        """Return whether provider threads should be used, from site flag."""
        try:
            val = get_site_configuration_value("ai_eval", "PROVIDER_SUPPORTS_THREADS")
            return bool(val)
        except Exception:  # pylint: disable=broad-exception-caught
            return False
