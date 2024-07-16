"""Base Xblock with AI evaluation."""

import pkg_resources

from django.utils.translation import gettext_noop as _
from xblock.core import XBlock
from xblock.fields import String, Scope, Dict
from xblock.validation import ValidationMessage


from .llm import SupportedModels

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

    USER_KEY = "USER"
    LLM_KEY = "LLM"

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
            "This required with models that don't have an official provider such as Llama."
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
        # default=SupportedModels.GPT4O,
        Scope=Scope.settings,
    )

    evaluation_prompt = String(
        display_name=_("Evaluation prompt"),
        help=_(
            "Enter the evaluation prompt given to the model."
            "The question will be inserted right after it."
            "The student's answer would then follow the question. Markdown format can be used."
            "Refer to https://marked.js.org/demo/"
        ),
        default="You are a teacher. Evaluate the student's answer for the following question:",
        multiline_editor=True,
        scope=Scope.settings,
    )
    question = String(
        display_name=_("Question"),
        help=_(
            "Enter the question you would like the students to answer."
            "Markdown format can be used."
            "Refer to https://marked.js.org/demo/"
        ),
        default="",
        multiline_editor=True,
        scope=Scope.settings,
    )

    messages = Dict(
        help=_("Dictionary with chat messages"),
        scope=Scope.user_state,
        default={USER_KEY: [], LLM_KEY: []},
    )
    editable_fields = (
        "display_name",
        "evaluation_prompt",
        "question",
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

        if not data.question:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR, _("Question field is mandatory")
                )
            )
