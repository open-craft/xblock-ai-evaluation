"""
Integration with LLMs.
"""

from enum import Enum
from litellm import completion


class SupportedModels(Enum):
    """
    LLM Models supported by the CodingAIEvalXBlock and ShortAnswerAIEvalXBlock
    """

    GPT4O = "gpt-4o"
    GPT4O_MINI = "gpt-4o-mini"
    GEMINI_PRO = "gemini/gemini-pro"
    CLAUDE_SONNET = "claude-3-5-sonnet-20240620"
    LLAMA = "ollama/llama2"

    @staticmethod
    def list():
        return [str(m.value) for m in SupportedModels]


def get_llm_response(
    model: SupportedModels, api_key: str, messages: list, api_base: str
) -> str:
    """
    Get LLm response.

    Args:
        model (SupportedModels): The model to use for generating the response. This should be an instance of
            the SupportedModels enum, specifying which LLM model to call.
        api_key (str): The API key required for authenticating with the LLM service. This key should be kept
            confidential and used to authorize requests to the service.
        messages (list): A list of message objects to be sent to the LLM. Each message should be a dictionary
            with the following format:

            {
                "content": str,   # The content of the message. This is the text that you want to send to the LLM.
                "role": str       # The role of the message sender. This must be one of the following values:
                                  # "user"    - Represents a user message.
                                  # "system"  - Represents a system message, typically used for instructions or context.
                                  # "assistant" - Represents a response or message from the LLM itself.
            }

            Example:
            [
                {"content": "Hello, how are you?", "role": "user"},
                {"content": "I'm here to help you.", "role": "assistant"}
            ]
        api_base (str): The base URL of the LLM API endpoint. This is the root URL used to construct the full
            API request URL. This is required only when using Llama which doesn't have an official provider.

    Returns:
        str: The response text from the LLM. This is typically the generated output based on the provided
            messages.
    """
    kwargs = {}
    if api_base:
        kwargs["api_base"] = api_base
    return (
        completion(model=model, api_key=api_key, messages=messages, **kwargs)
        .choices[0]
        .message.content
    )
