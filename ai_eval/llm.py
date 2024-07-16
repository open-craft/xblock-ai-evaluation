"""
Integration with LLMs.
"""

from enum import Enum
from litellm import completion


class SupportedModels(Enum):
    """
    Supported Models
    """

    GPT4O = "gpt-4o"
    GEMINI_PRO = "gemini/gemini-pro"
    CLAUDE_SONNET = "claude-3-5-sonnet-20240620"
    LLAMA = "ollama/llama2"

    @staticmethod
    def list():
        return list(map(lambda m: str(m.value), SupportedModels))


def get_llm_response(
    model: SupportedModels, api_key: str, messages: list, api_base: str
) -> str:
    """
    Get LLm response.
    """
    kwargs = {}
    if api_base:
        kwargs["api_base"] = api_base
    return (
        completion(model=model, api_key=api_key, messages=messages, **kwargs)
        .choices[0]
        .message.content
    )
