"""Base Xblock with AI evaluation."""
from typing import Any, Self

import logging
from importlib.resources import files
from django.core.cache import cache

from django.utils.translation import gettext_noop as _
from xblock.core import XBlock
from xblock.fields import String, Scope, Dict
from xblock.utils.resources import ResourceLoader
from xblock.utils.studio_editable import StudioEditableXBlockMixin
from xblock.validation import ValidationMessage

from .compat import get_site_configuration_value
from .supported_models import SupportedModels
from .llm import get_llm_response, get_llm_service


logger = logging.getLogger(__name__)


def _get_model_choices(block):
    """
    Return the dropdown entries for the `model` field.
    If the remote service fails, fall back to SupportedModels.list().
    """
    available_models = []

    try:
        llm_service = get_llm_service()
        available_models = llm_service.get_available_models()

        # Ensure we have models, fallback if empty
        if not available_models:
            logger.warning("Custom service returned empty models list, using defaults")
            available_models = SupportedModels.list()
            # Record a warning for Studio validation
            try:
                # Cache a short-lived warning keyed by usage_id to be surfaced during validation
                usage_id = getattr(getattr(block, "scope_ids", None), "usage_id", None)
                if usage_id:
                    cache_key = f"ai_eval:models_warn:{usage_id}"
                    cache.set(
                        cache_key,
                        _(
                            "Custom LLM service did not return any models. Showing default models instead. "
                            "Check custom service availability/configuration and try again, or configure API keys "
                            "for the default models."
                        ),
                        timeout=120,
                    )
            # pylint: disable=broad-exception-caught
            except Exception:  # pragma: no cover - best-effort, avoid breaking dropdown population
                pass

    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.error(
            f"Failed to populate model choices dynamically; falling back to default models. Error: {e}",
            exc_info=True,
        )
        available_models = SupportedModels.list()

    PLACEHOLDER = {"display_name": "— Select a model —", "value": ""}

    return [PLACEHOLDER] + [{"display_name": m, "value": m} for m in available_models]


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
            "Fill this only for LLama. This is required with models that don't have an official provider."
            " Example URL: https://model-provider-example/llama3_70b"
        ),
        default=None,
        scope=Scope.settings,
    )
    model = String(
        display_name=_("AI model"),
        help=_("Select the AI language model to use."),
        scope=Scope.settings,
        default="",
        values_provider=_get_model_choices,
    )
    thread_map = Dict(
        help=_("Map of provider thread IDs keyed by tag"),
        default={},
        scope=Scope.user_state,
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
        return files("ai_eval").joinpath(path).read_text(encoding="utf8")

    def _get_model_config_value(self, config_parameter: str, obj: Self = None) -> str | None:
        """
        Get configuration value for the model provider with a fallback chain.

        For `api_key`, checks:
        1. Site configuration
        2. XBlock settings (defined in Django settings)
        3. XBlock field (model_api_key)

        For other parameters (e.g. `api_url`), checks:
        1. XBlock field
        2. Site configuration
        3. XBlock settings

        Args:
            config_parameter: Parameter to retrieve (e.g., "API_KEY" or "API_URL").
            obj: Optional data object for validation context.

        Returns:
            The configuration value if found in any of the sources, None otherwise.
        """
        obj = obj or self
        field_name = f"model_{config_parameter}"

        if config_parameter == "api_key":
            # When configured globally/site-wide, ignore XBlock-local model_api_key.
            if value := self._get_site_or_global_config_value(
                config_parameter,
                obj=obj,
            ):
                return value
            if value := getattr(obj, field_name, None):
                return str(value)
            return None

        config_key = self._get_model_config_key(obj.model, config_parameter)

        if value := getattr(obj, field_name, None):
            return str(value)
        if value := get_site_configuration_value(self.block_settings_key, config_key):
            return value
        return self._get_settings().get(config_key)

    @staticmethod
    def _get_model_config_key(model: str, config_parameter: str) -> str:
        """Build model configuration key name for site/global settings lookups."""
        # For custom models, use the model name directly; for supported models, use the enum name
        try:
            model_name = SupportedModels(model).name
        except ValueError:
            model_name = model.replace("/", "_").replace("-", "_").upper()

        return f"{model_name}_{config_parameter.upper()}"

    def _get_site_or_global_config_value(
        self,
        config_parameter: str,
        obj: Self = None,
        model: str | None = None,
    ) -> str | None:
        """
        Return model config from site/global settings.

        If `model` is provided, it is used directly. Otherwise, model is read
        from `obj.model` (or `self.model` when obj is omitted).
        """
        if model is None:
            obj = obj or self
            model = getattr(obj, "model", None)

        if not model:
            return None

        config_key = self._get_model_config_key(model, config_parameter)
        if value := get_site_configuration_value(self.block_settings_key, config_key):
            return value
        return self._get_settings().get(config_key)

    @staticmethod
    def _is_truthy(value) -> bool:
        """
        Normalize booleans that may be provided as strings.
        """
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    def _is_custom_llm_service_enabled(self) -> bool:
        """
        Check if custom LLM service is enabled via site/global config.
        """
        site_value = get_site_configuration_value(self.block_settings_key, "USE_CUSTOM_LLM_SERVICE")
        if site_value is not None:
            return self._is_truthy(site_value)
        return self._is_truthy(self._get_settings().get("USE_CUSTOM_LLM_SERVICE"))

    def should_lock_model_api_key_field(self, obj: Self = None) -> bool:
        """
        Lock model API key field when custom LLM service is enabled or key is globally provided.
        """
        return bool(
            self._is_custom_llm_service_enabled()
            or self._get_site_or_global_config_value(
                "api_key",
                obj=obj,
            )
        )

    def _get_model_key_presence_map(self) -> dict[str, bool]:
        """
        Return a map of model name -> whether an API key is configured site/global.
        """
        models = list(SupportedModels.list())
        if self.model and self.model not in models:
            models.append(self.model)

        return {
            model: bool(
                self._get_site_or_global_config_value(
                    "api_key",
                    model=model,
                )
            )
            for model in models
        }

    def _get_studio_lock_payload(self) -> dict:
        """
        Return Studio-side lock metadata for API key fields.
        """
        return {
            "use_custom_llm_service": self._is_custom_llm_service_enabled(),
            "initial_model": self.model or "",
            "model_key_presence": self._get_model_key_presence_map(),
            "lock_model_api_key_initial": self.should_lock_model_api_key_field(),
            "lock_judge0_api_key": False,
        }

    def _get_react_studio_field_choices(self, field_name: str) -> list[dict[str, Any]]:
        """
        Return normalized choice metadata for a Studio-editable field.
        """
        field = self.fields[field_name]
        values_provider = getattr(field, "values_provider", None)
        values = None

        if callable(values_provider):
            values = values_provider(self)
        elif hasattr(field, "values"):
            values = getattr(field, "values")

        if not values:
            return []

        normalized = []
        for value in values:
            if isinstance(value, dict):
                normalized.append(value)
            else:
                normalized.append({
                    "display_name": str(value),
                    "value": value,
                })
        return normalized

    def _get_react_studio_field_metadata(self) -> dict[str, dict[str, Any]]:
        """
        Return field labels, help text, defaults, and choices for React Studio.
        """
        metadata = {}

        for field_name in self.editable_fields:
            field = self.fields[field_name]
            metadata[field_name] = {
                "display_name": str(getattr(field, "display_name", field_name) or field_name),
                "help": str(getattr(field, "help", "") or ""),
                "default": getattr(field, "default", None),
                "choices": self._get_react_studio_field_choices(field_name),
            }

        return metadata

    def _get_react_studio_initial_state(self) -> dict[str, Any]:
        """
        Return current editable values for React Studio boot payloads.
        """
        return {
            field_name: getattr(self, field_name)
            for field_name in self.editable_fields
        }

    def _get_react_studio_meta(self) -> dict[str, Any]:
        """
        Return additive metadata for future React Studio views.
        """
        return {
            "field_metadata": self._get_react_studio_field_metadata(),
            "lock_metadata": self._get_studio_lock_payload(),
        }

    def _get_react_boot_payload(
        self,
        view: str,
        handler_urls: dict[str, str],
        initial_state: dict[str, Any],
        meta: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Return the normalized React boot payload shape used by future views.
        """
        return {
            "view": view,
            "handler_urls": handler_urls,
            "initial_state": initial_state,
            "meta": meta,
        }

    @staticmethod
    def _build_react_studio_submit_response(
        success: bool,
        validation_errors: dict[str, Any] | None = None,
        validation_warnings: list[str] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Return the shared response shape planned for React Studio saves.
        """
        return {
            "success": success,
            "validation_errors": validation_errors or {},
            "validation_warnings": validation_warnings or [],
            "meta": meta or {},
        }

    def studio_view(self, context):
        """
        Render Studio editor and initialize API-key field lock behavior.
        """
        fragment = super().studio_view(context)
        fragment.add_css(self.resource_string("static/css/studio_api_key_lock.css"))
        fragment.add_javascript(self.resource_string("static/js/src/studio_api_key_lock.js"))
        fragment.initialize_js("AIEvalStudioEditor", self._get_studio_lock_payload())
        return fragment

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
        Validate fields and populate model choices dynamically.
        """
        from .llm_services import DefaultLLMService  # pylint: disable=import-outside-toplevel
        llm_service = get_llm_service()
        # Add warning if custom service is configured but using defaults
        use_custom_service = get_site_configuration_value("ai_eval", "USE_CUSTOM_LLM_SERVICE")
        if use_custom_service and llm_service and isinstance(llm_service, DefaultLLMService):
            validation.add(
                ValidationMessage(
                    ValidationMessage.WARNING,
                    _(
                        "Custom LLM service is enabled but using default models due to configuration issues. "
                        "Check logs for details."
                    )
                )
            )

        # Surface any warning captured during model choices population without re-calling the service.
        usage_id = getattr(getattr(self, "scope_ids", None), "usage_id", None)
        if usage_id:
            cache_key = f"ai_eval:models_warn:{usage_id}"
            warning_msg = cache.get(cache_key)
            if warning_msg:
                validation.add(ValidationMessage(ValidationMessage.WARNING, warning_msg))
                cache.delete(cache_key)

        if not data.model:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    _("Model field is mandatory - please select one from the dropdown.")
                )
            )

        # Only run these checks for the default service
        if isinstance(llm_service, DefaultLLMService):
            if not self.get_model_api_key(data):
                validation.add(
                    ValidationMessage(
                        ValidationMessage.ERROR,
                        _("Model API key is mandatory, if not set globally by your administrator.")
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

    def get_llm_response(self, messages, tag: str | None = None):
        """
        Call the shared LLM entrypoint and return only the response text.
        """
        prior_thread_id = None
        if tag:
            try:
                prior_thread_id = (self.thread_map or {}).get(tag) or None
            except Exception:  # pylint: disable=broad-exception-caught
                prior_thread_id = None

        text, new_thread_id = get_llm_response(
            self.model,
            self.get_model_api_key(),

            list(messages), self.get_model_api_url(),
            thread_id=prior_thread_id,
        )
        if tag and new_thread_id:
            tm = dict(getattr(self, "thread_map", {}) or {})
            tm[tag] = new_thread_id
            self.thread_map = tm
        return text
