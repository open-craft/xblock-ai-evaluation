"""Base Xblock with AI evaluation."""

import pkg_resources

from django.utils.translation import gettext_noop as _
from xblock.core import XBlock
from xblock.fields import String, Scope
from xblock.validation import ValidationMessage

from .llm import SupportedModels, get_llm_response

try:
    from xblock.utils.studio_editable import StudioEditableXBlockMixin
except ModuleNotFoundError:  # For compatibility with Palm and earlier
    from xblockutils.studio_editable import StudioEditableXBlockMixin

try:
    from xblock.utils.resources import ResourceLoader
except (
    ModuleNotFoundError
):  # For backward compatibility with releases older than Quince.
    from xblockutils.resources import ResourceLoader


class AIEvalXBlock(StudioEditableXBlockMixin, XBlock):
    """
    Base class for Xblocks with AI evaluation
    """

    loader = ResourceLoader(__name__)

    icon_class = "problem"
    model_api_key = String(
        display_name=_("Chosen model API Key"),
        help=_("Enter your the API Key of your chosen model."),
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

    def resource_string(self, path):
        """Handy helper for getting resources from our kit."""
        data = pkg_resources.resource_string(__name__, path)
        return data.decode("utf8")

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

        if not data.model_api_key:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR, _("Model API key is mandatory")
                )
            )

        if data.model == SupportedModels.LLAMA and not data.model_api_url:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    _("API URL field is mandatory when using ollama/llama2."),
                )
            )

        if data.model != SupportedModels.LLAMA and data.model_api_url:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    _("API URL field can be set only when using ollama/llama2."),
                )
            )

    def get_llm_response(self, messages):
        return get_llm_response(self.model, self.model_api_key, messages,
                                self.model_api_url)
