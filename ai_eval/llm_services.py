import requests
from litellm import completion
from .llm import SupportedModels

class LLMServiceBase:
    def get_response(self, model, api_key, messages, api_base):
        raise NotImplementedError

    def get_available_models(self):
        raise NotImplementedError

class DefaultLLMService(LLMServiceBase):
    def get_response(self, model, api_key, messages, api_base):
        kwargs = {}
        if api_base:
            kwargs["api_base"] = api_base
        return (
            completion(model=model, api_key=api_key, messages=messages, **kwargs)
            .choices[0]
            .message.content
        )
    def get_available_models(self):
        return [str(m.value) for m in SupportedModels]

class CustomLLMService(LLMServiceBase):
    def __init__(self, models_url, completions_url, token_url, client_id, client_secret):
        self.models_url      = models_url
        self.completions_url = completions_url
        self.token_url       = token_url
        self.client_id       = client_id
        self.client_secret   = client_secret
        self._access_token   = None
        self._expires_at     = 0

    def _fetch_token(self):
        data = {'grant_type': 'client_credentials'}
        auth = (self.client_id, self.client_secret)
        response = requests.post(self.token_url, data=data, auth=auth)
        response.raise_for_status()
        token_data = response.json()
        self._access_token = token_data['access_token']
        expires_in = token_data.get('expires_in')
        import time
        if expires_in:
            self._expires_at = time.time() + expires_in - 60
        else:
            self._expires_at = time.time() + 3300

    def _ensure_token(self):
        import time
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
        response = requests.post(url, json=payload, headers=self._get_headers())
        response.raise_for_status()
        data = response.json()
        # TODO: Adjust this if custom API returns the response differently
        return data.get("response")

    def get_available_models(self):
        url = self.models_url
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=10)
            response.raise_for_status()
            data = response.json()
            if isinstance(data, dict):
                if "models" in data and isinstance(data["models"], list):
                    return [str(m) for m in data["models"]]
                elif "data" in data and isinstance(data["data"], list):
                    return [str(m.get("id", m)) for m in data["data"]]
            elif isinstance(data, list):
                return [str(m) for m in data]
            return []
        except Exception:
            return []
