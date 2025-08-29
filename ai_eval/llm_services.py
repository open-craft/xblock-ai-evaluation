"""LLM Services Module"""

import logging
import time
import requests

from litellm import completion
from .supported_models import SupportedModels
from .compat import get_site_configuration_value

logger = logging.getLogger(__name__)

DEFAULT_TOKEN_EXPIRES_IN = 3300


class LLMServiceBase:
    """
    Base class for llm service.
    """
    # pylint: disable=too-many-positional-arguments
    def get_response(self, model, api_key, messages, api_base, thread_id=None, use_threads=False):
        """Get a response from the provider.

        Args:
            model (str): Model identifier.
            api_key (str): API key (for default providers or passthrough).
            messages (list[dict]): Chat messages.
            api_base (str|None): Optional base URL (e.g., for llama/ollama).
            thread_id (str|None): Optional provider-side conversation/thread id.
            use_threads (bool): Whether provider threads are enabled by policy.

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
            use_threads=False
    ):
        kwargs = {}
        if api_base:
            kwargs["api_base"] = api_base
        text = (
            completion(model=model, api_key=api_key, messages=messages, **kwargs)
            .choices[0]
            .message.content
        )
        return text, None

    def get_available_models(self):
        return [str(m.value) for m in SupportedModels]

    def supports_threads(self) -> bool:  # pragma: nocover - default is stateless
        return False


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
        response = requests.post(self.token_url, data=data, headers=headers, timeout=10)
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

    def get_response(
            self,
            model,
            api_key,
            messages,
            api_base,
            thread_id=None,
            use_threads=False
    ):
        """
        Send completion request to custom LLM endpoint.
        """
        url = self.completions_url
        # When reusing an existing thread, only send the latest user input and rely on
        # the provider to apply prior context associated with the conversation_id.
        if use_threads and thread_id:
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
        payload = {
            "model": str(model),
            "prompt": prompt,
        }
        # If threads are enabled, pass through conversation id when available
        # and let the provider initialize a new thread if not.
        if use_threads and thread_id:
            payload["conversation_id"] = thread_id

        response = requests.post(url, json=payload, headers=self._get_headers(), timeout=10)
        response.raise_for_status()
        data = response.json()
        # Adjust this if custom API returns the response differently
        text = data.get("response")
        # Try to capture a new conversation/thread id if the API returns one.
        new_thread_id = None
        if use_threads:
            new_thread_id = (
                data.get("conversation_id")
                or (data.get("data", {}) if isinstance(data.get("data"), dict) else {}).get("conversation_id")
            )
        return text, new_thread_id

    def get_available_models(self):
        url = self.models_url
        try:
            if not url:
                logger.warning("CUSTOM_LLM_MODELS_URL not configured")
                return []

            response = requests.get(url, headers=self._get_headers(), timeout=10)
            response.raise_for_status()
            data = response.json()

            models = []

            if isinstance(data, dict):
                if "models" in data:
                    if isinstance(data["models"], list):
                        models = [str(m) for m in data["models"]]
                    elif isinstance(data["models"], str):
                        models = [str(data["models"])]
                elif "data" in data and isinstance(data["data"], list):
                    models = [str(m.get("id", str(m))) for m in data["data"]]
            elif isinstance(data, list):
                models = [str(m) for m in data]
            elif isinstance(data, str):
                models = [str(data)]

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
            return bool(get_site_configuration_value("ai_eval", "USE_PROVIDER_THREADS"))
        except Exception:  # pylint: disable=broad-exception-caught
            return False
