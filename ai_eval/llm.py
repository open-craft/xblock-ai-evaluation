"""
Integration with LLMs.
"""
from django.conf import settings
from enum import Enum
from .compat import get_site_configuration_value


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


def get_llm_service():
    from .llm_services import DefaultLLMService, CustomLLMService
    use_custom_service = get_site_configuration_value("ai_eval", "USE_CUSTOM_LLM_SERVICE")
    if use_custom_service:
        models_url     = get_site_configuration_value("ai_eval", "CUSTOM_LLM_MODELS_URL")
        completions_url = get_site_configuration_value("ai_eval", "CUSTOM_LLM_COMPLETIONS_URL")
        token_url      = get_site_configuration_value("ai_eval", "CUSTOM_LLM_TOKEN_URL")
        client_id      = settings.CUSTOM_LLM_CLIENT_ID
        client_secret  = settings.CUSTOM_LLM_CLIENT_SECRET
        return CustomLLMService(models_url, completions_url, token_url, client_id, client_secret)
    return DefaultLLMService()


def get_llm_response(
    model: str, api_key: str, messages: list, api_base: str
) -> str:
    """
    Get LLM response, using either the default or custom service based on site configuration.

    Args:
        model (str): The model to use for generating the response. This can be either a supported
            default model or a custom model name depending on the configured service.
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
    llm_service = get_llm_service()
    return llm_service.get_response(model, api_key, messages, api_base)
