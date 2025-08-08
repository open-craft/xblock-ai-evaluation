import requests
from typing import Dict, Any
from .base import CodeExecutionBackend
from ai_eval.utils import SUPPORTED_LANGUAGE_MAP, LanguageLabels


class Judge0Backend(CodeExecutionBackend):
    """
    Judge0 code execution backend.
    """
    
    def __init__(self, api_key: str = "", base_url: str = None):
        self.api_key = api_key
        self.base_url = base_url or "https://judge0-ce.p.rapidapi.com"
    
    def submit_code(self, code: str, language_label: str) -> str:
        """
        Submit code to Judge0 for execution.
        """
        if not self.api_key:
            raise ValueError("Judge0 API key is required")
        
        # Map the human-readable label to Judge0 numeric id
        try:
            judge0_id = SUPPORTED_LANGUAGE_MAP[language_label].judge0_id
        except KeyError as e:
            raise ValueError(f"Unsupported language: {language_label}") from e

        url = f"{self.base_url}/submissions"
        headers = {
            'content-type': 'application/json',
            'x-rapidapi-key': self.api_key
        }
        payload = {
            'source_code': code,
            'language_id': int(judge0_id)
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            
            result = response.json()
            if 'token' in result:
                return result['token']
            else:
                raise ValueError("Judge0 response missing submission token")
                
        except requests.RequestException as e:
            raise ValueError(f"Failed to submit code to Judge0: {e}")
        except (KeyError, ValueError) as e:
            raise ValueError(f"Invalid response from Judge0: {e}")
    
    def get_result(self, submission_id: str) -> Dict[str, Any]:
        """
        Get execution result from Judge0.
        """
        if not self.api_key:
            raise ValueError("Judge0 API key is required")
        
        url = f"{self.base_url}/submissions/{submission_id}"
        headers = {'x-rapidapi-key': self.api_key}
        
        try:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            
            return response.json()
            
        except requests.RequestException as e:
            raise ValueError(f"Failed to get submission result from Judge0: {e}")
        except (KeyError, ValueError) as e:
            raise ValueError(f"Invalid response from Judge0: {e}")
    
