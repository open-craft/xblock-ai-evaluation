"""Base Xblock with AI evaluation."""
from typing import Self

import pkg_resources

from django.utils.translation import gettext_noop as _
from xblock.core import XBlock
from xblock.fields import String, Scope
from xblock.utils.resources import ResourceLoader
from xblock.utils.studio_editable import StudioEditableXBlockMixin
from xblock.validation import ValidationMessage

from .compat import get_site_configuration_value
from .llm import SupportedModels, get_llm_response


@XBlock.wants("settings")
class AIEvalXBlock(StudioEditableXBlockMixin, XBlock):
    """
    Base class for Xblocks with AI evaluation
    """

    loader = ResourceLoader(__name__)

    icon_class = "problem"
    model_api_key = String(
        display_name=_("Chosen model API Key"),
        help=_("Enter the API Key of your chosen model. Not required if your administrator has set it globally."),
        default="",
        scope=Scope.settings,
    )
    model_api_url = String(
        display_name=_("Set your API URL"),
        help=_(
            "Fill this only for LLama. This required with models that don't have an official provider."
            " Example URL: https://model-provider-example/llama3_70b"
        ),
        default=None,
        scope=Scope.settings,
    )
    model = String(
        display_name=_("AI model"),
        help=_("Select the AI language model to use."),
        values=[
            {"display_name": model, "value": model} for model in SupportedModels.list()
        ],
        Scope=Scope.settings,
        default=SupportedModels.GPT4O.value,
    )

    editable_fields = (
        "display_name",
        "model",
        "model_api_key",
        "model_api_url",
    )

    block_settings_key = "ai_eval"

    def _get_settings(self) -> dict:  # pragma: nocover
        """Get the XBlock settings bucket via the SettingsService."""
        settings_service = self.runtime.service(self, "settings")
        if settings_service:
            return settings_service.get_settings_bucket(self)

        return {}

    def resource_string(self, path):
        """Handy helper for getting resources from our kit."""
        data = pkg_resources.resource_string(__name__, path)
        return data.decode("utf8")

    def _get_model_config_value(self, config_parameter: str, obj: Self = None) -> str | None:
        """
        Get configuration value for the model provider with a fallback chain.

        Checks for the value in the following order:
        1. XBlock field (model_api_key or model_api_url)
        2. Site configuration
        3. XBlock settings (defined in Django settings)

        Args:
            config_parameter: Parameter to retrieve (e.g., "API_KEY" or "API_URL").
            obj: Optional data object for validation context.

        Returns:
            The configuration value if found in any of the sources, None otherwise.
        """
        obj = obj or self
        field_name = f"model_{config_parameter}"
        config_key = f"{SupportedModels(obj.model).name}_{config_parameter.upper()}"

        # XBlock field
        if value := getattr(obj, field_name, None):
            return str(value)

        # Site configuration
        if value := get_site_configuration_value(self.block_settings_key, config_key):
            return value

        # XBlock settings
        return self._get_settings().get(config_key)

    def get_model_api_key(self, obj: Self = None) -> str | None:
        """Get the API key for the model provider."""

        return self._get_model_config_value("api_key", obj)

    def get_model_api_url(self, obj: Self = None) -> str | None:
        """
        Get the API URL for the model provider.
        """
        return self._get_model_config_value("api_url", obj)

    def validate_field_data(self, validation, data):
        """
        Validate fields.
        """

        if not data.model or data.model not in SupportedModels.list():
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    _(  # pylint: disable=translation-of-non-string
                        f"Model field is mandatory and must be one of {', '.join(SupportedModels.list())}"
                    ),
                )
            )

        if not self.get_model_api_key(data):
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR, _("Model API key is mandatory, if not set globally by your administrator.")
                )
            )

        if data.model == SupportedModels.LLAMA.value and not self.get_model_api_url(data):
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    _(
                        "API URL field is mandatory when using ollama/llama2, "
                        "if not set globally by your administrator."
                    ),
                )
            )

        if data.model != SupportedModels.LLAMA.value and data.model_api_url:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    _("API URL field can be set only when using ollama/llama2."),
                )
            )

    def get_llm_response(self, messages):
        return get_llm_response(self.model, self.get_model_api_key(), messages,
                                self.get_model_api_url())
