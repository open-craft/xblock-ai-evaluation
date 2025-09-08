"""
Integration with LLMs.
"""
import logging
from django.conf import settings
from .compat import get_site_configuration_value
from .llm_services import DefaultLLMService, CustomLLMService

logger = logging.getLogger(__name__)


def get_llm_service():
    """
    Get the CustomLLMService if configured otherwise return the default service.
    """
    use_custom_service = get_site_configuration_value("ai_eval", "USE_CUSTOM_LLM_SERVICE")
    if use_custom_service:
        models_url = get_site_configuration_value("ai_eval", "CUSTOM_LLM_MODELS_URL")
        completions_url = get_site_configuration_value("ai_eval", "CUSTOM_LLM_COMPLETIONS_URL")
        token_url = get_site_configuration_value("ai_eval", "CUSTOM_LLM_TOKEN_URL")

        # Validate required configuration
        missing_configs = []
        if not models_url:
            missing_configs.append("CUSTOM_LLM_MODELS_URL")
        if not completions_url:
            missing_configs.append("CUSTOM_LLM_COMPLETIONS_URL")
        if not token_url:
            missing_configs.append("CUSTOM_LLM_TOKEN_URL")

        try:
            client_id = settings.CUSTOM_LLM_CLIENT_ID
            client_secret = settings.CUSTOM_LLM_CLIENT_SECRET
            if not client_id:
                missing_configs.append("CUSTOM_LLM_CLIENT_ID")
            if not client_secret:
                missing_configs.append("CUSTOM_LLM_CLIENT_SECRET")
        except AttributeError:
            missing_configs.extend(["CUSTOM_LLM_CLIENT_ID", "CUSTOM_LLM_CLIENT_SECRET"])

        if missing_configs:
            logger.warning(
                f"Custom LLM service requested but missing configuration: {', '.join(missing_configs)}. "
                f"Falling back to default service."
            )
            return DefaultLLMService()

        return CustomLLMService(models_url, completions_url, token_url, client_id, client_secret)
    return DefaultLLMService()


def get_llm_response(
    model: str, api_key: str, messages: list, api_base: str, thread_id: str | None = None
) -> tuple[str, str | None]:
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
        tuple[str, Optional[str]]: The response text and a new thread id if a provider thread was created/used.
    """
    llm_service = get_llm_service()
    allow_threads = False
    try:
        allow_threads = bool(llm_service.supports_threads())
    except Exception:  # pylint: disable=broad-exception-caught
        allow_threads = False

    # Continue threaded conversation when a thread_id is provided
    if thread_id:
        return llm_service.get_response(model, api_key, messages, api_base, thread_id=thread_id)

    # Start a new thread only when allowed in config setting
    if allow_threads:
        return llm_service.start_thread(model, api_key, messages, api_base)

    # Stateless call - do not create or persist any conversation id
    return llm_service.get_response(model, api_key, messages, api_base, thread_id=None)
