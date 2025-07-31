"""LLM Services Module"""

import logging
import time
import requests

from litellm import completion
from .supported_models import SupportedModels

logger = logging.getLogger(__name__)

DEFAULT_TOKEN_EXPIRES_IN = 3300


class LLMServiceBase:
    """
    Base class for llm service.
    """
    def get_response(self, model, api_key, messages, api_base):
        raise NotImplementedError

    def get_available_models(self):
        raise NotImplementedError


class DefaultLLMService(LLMServiceBase):
    """
    Default llm service.
    """
    def get_response(self, model, api_key, messages, api_base):
        kwargs = {}
        if api_base:
            kwargs["api_base"] = api_base
        try:
            return (
                completion(model=model, api_key=api_key, messages=messages, timeout=30, **kwargs)
                .choices[0]
                .message.content
            )
        except Exception as e:
            if "timeout" in str(e).lower():
                raise Exception("We're sorry, but the connection timed out. Please try that request again.")
            raise

    def get_available_models(self):
        return [str(m.value) for m in SupportedModels]


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

    def get_response(self, model, api_key, messages, api_base):
        """
        Send completion request to custom LLM endpoint.
        """
        url = self.completions_url
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
            response = requests.post(url, json=payload, headers=self._get_headers(), timeout=30)
            response.raise_for_status()
            data = response.json()
            # Adjust this if custom API returns the response differently
            return data.get("response")
        except requests.exceptions.Timeout:
            raise Exception("We're sorry, but the connection timed out. Please try that request again.")

    def get_available_models(self):
        url = self.models_url
        try:
            if not url:
                logger.warning("CUSTOM_LLM_MODELS_URL not configured")
                return []

            response = requests.get(url, headers=self._get_headers(), timeout=30)
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
