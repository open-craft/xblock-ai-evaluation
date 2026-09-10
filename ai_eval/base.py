"""Base Xblock with AI evaluation."""
from typing import Any, Self

import hashlib
import logging
import urllib.parse
import urllib.request
import codecs
from importlib.resources import files
from multiprocessing.dummy import Pool
from xml.sax import saxutils

import chardet
from django.conf import settings
from django.core.cache import cache
from django.utils.text import slugify
from django.utils.translation import gettext_noop as _
from webob import Response
from xblock.core import XBlock
from xblock.fields import Boolean, String, Scope, Dict
from xblock.utils.resources import ResourceLoader
from xblock.utils.studio_editable import StudioEditableXBlockMixin
from xblock.validation import ValidationMessage

from .compat import get_site_configuration_value, get_pdf_location_nav
from .utils import DEFAULT_HTTP_TIMEOUT
from .pdf_generator import generate_pdf, Metadata, CoachedData, CodingData, ShortAnswerData, Branding, Student, Info
from .llm import get_llm_response, get_llm_service
from .llm_services import DefaultLLMService
from .supported_models import SupportedModels, model_maps, resolve_model


logger = logging.getLogger(__name__)


class AttachmentDownloadError(Exception):
    """Raised when an attachment URL cannot be downloaded.

    Carries the offending ``url`` so callers can build a user-facing message
    without parsing the exception text; the underlying cause is chained.
    """

    def __init__(self, url, cause):
        self.url = url
        super().__init__(f'Error downloading "{url}": {cause}')


def _get_model_choices(block):
    """
    Return the dropdown entries for the `model` field.

    The service supplies the list: the default service returns the effective model
    id per supported slot (the operator's ``<NAME>_MODEL`` override, else the code
    default); a custom LLM service returns its own catalog. If a custom service
    returns nothing we fall back to the effective defaults.
    """
    # pylint: disable=protected-access
    available_models = []

    try:
        available_models = get_llm_service().get_available_models()

        # Ensure we have models, fallback if empty (custom service returned nothing)
        if not available_models:
            logger.warning("Custom service returned empty models list, using defaults")
            available_models = block._effective_supported_models()
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
                            "Check custom service availability/configuration and try again, or configure "
                            "API keys for the default models."
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
        # Last-resort fallback must not touch site config (it may be what failed):
        # use the static enum list so the dropdown always populates.
        available_models = SupportedModels.list()

    PLACEHOLDER = {"display_name": "— Select a model —", "value": ""}

    return [PLACEHOLDER] + [{"display_name": m, "value": m} for m in available_models]


@XBlock.wants("settings", "user")
class AIEvalXBlock(StudioEditableXBlockMixin, XBlock):
    """
    Base class for Xblocks with AI evaluation
    """

    resources_dir = ""
    public_dir = "static"

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

    pdf_download_allowed = Boolean(
        display_name=_("Allow PDF Download"),
        help=_(
            "If enabled, learners can download a PDF transcript of the problem."
        ),
        default=False,
        scope=Scope.settings,
    )
    pdf_download_title = String(
        display_name=_("Download Section Title"),
        help=_("Title of the section that contains the PDF transcript download button."),
        default="Download transcript",
        scope=Scope.settings,
    )
    pdf_download_description = String(
        display_name=_("Download Section Description"),
        help=_("Description of the section that contains the PDF transcript download button."),
        default="",
        scope=Scope.settings,
    )

    editable_fields = (
        "display_name",
        "model",
        "model_api_key",
        "model_api_url",
        "pdf_download_allowed",
        "pdf_download_title",
        "pdf_download_description",
    )

    block_settings_key = "ai_eval"

    ATTACHMENT_PARALLEL_DOWNLOADS = 5
    ATTACHMENT_CACHE_TTL = 600
    ATTACHMENT_CACHE_MAX_BYTES = 900_000

    DEFAULT_CHARACTER_LIMIT = 1000

    def _replace_current_session(self, session_data):
        """
        Replace the current session entry so XBlock dirty-tracking persists it.

        Mutating nested keys inside ``self.sessions[-1]`` is not reliably detected by
        the field persistence layer.
        """
        sessions = list(self.sessions or [])  # pylint: disable=access-member-before-definition
        if sessions:
            sessions[-1] = session_data
        else:
            sessions = [session_data]
        self.sessions = sessions  # pylint: disable=attribute-defined-outside-init

    def _get_settings(self) -> dict:  # pragma: nocover
        """Get the XBlock settings bucket via the SettingsService."""
        settings_service = self.runtime.service(self, "settings")
        if settings_service:
            return settings_service.get_settings_bucket(self)

        return {}

    def resource_string(self, path):
        """Handy helper for getting resources from our kit."""
        return files("ai_eval").joinpath(path).read_text(encoding="utf8")

    def _download_attachment(self, url, refresh=False):
        """
        Return the decoded text of a single attachment URL, caching the result.

        The decoded text (not the raw bytes) is cached keyed by URL only, so a cache
        hit skips both the network fetch and the ``chardet`` detection/decoding. Pass
        ``refresh=True`` to bypass the cache and force a fresh download (used by Studio
        validation so it proves the URL is currently reachable); the fresh fetch still
        repopulates the cache, warming it for the next learner request.
        """
        key = "ai_eval:attachment:" + hashlib.sha256(url.encode("utf-8")).hexdigest()
        if not refresh:
            cached = cache.get(key)
            if cached is not None:
                return cached
        # timeout: avoid hanging indefinitely on unreachable hosts
        with urllib.request.urlopen(url, timeout=DEFAULT_HTTP_TIMEOUT) as f:
            data = f.read()
        # chardet can return None or an unrecognised encoding; validate and fallback
        encoding = chardet.detect(data).get("encoding")
        try:
            codecs.lookup(encoding)
        except (LookupError, TypeError):
            encoding = "utf-8"
        text = data.decode(encoding, errors="replace")
        # memcached silently drops values over ~1MB, which would turn every request into
        # a cache miss without any error. Skip caching very large files instead.
        if len(text.encode("utf-8")) <= self.ATTACHMENT_CACHE_MAX_BYTES:
            cache.set(key, text, self.ATTACHMENT_CACHE_TTL)
        return text

    def _filename_for_url(self, url):
        """Return the trailing path segment of a URL, used as the attachment filename."""
        return urllib.parse.urlparse(url).path.split('/')[-1]

    def _get_attachments(self, attachment_urls, refresh=False):
        """Download every URL in parallel and return ``[(filename, contents), ...]``."""
        normalized = [url.strip() for url in (attachment_urls or []) if url and url.strip()]

        if not normalized:
            return []

        # Wrap so Pool.map preserves batch parallelism but annotates failures
        # with the URL that caused them.
        def _try_download(url):
            try:
                return self._download_attachment(url, refresh=refresh)
            except Exception as e:
                raise AttachmentDownloadError(url, e) from e

        with Pool(self.ATTACHMENT_PARALLEL_DOWNLOADS) as pool:
            contents = pool.map(_try_download, normalized)
            filenames = map(self._filename_for_url, normalized)
            return list(zip(filenames, contents))

    def _render_attachments_xml(self, attachment_urls):
        """
        Download the URLs and return ``(xml_block, hash_inputs)``.

        ``xml_block`` is the newline-joined ``<attachment>`` blocks to splice into a
        prompt; ``hash_inputs`` is the per-file ``"{filename}|{contents}"`` strings a
        caller may fold into a cache/thread tag.
        """
        blocks, hash_inputs = [], []
        for filename, contents in self._get_attachments(attachment_urls):
            blocks.append(
                f"<attachment><filename>{saxutils.escape(filename)}</filename>"
                f"<contents>{saxutils.escape(contents)}</contents></attachment>"
            )
            hash_inputs.append(f"{filename}|{contents}")
        return "\n".join(blocks), hash_inputs

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
        return self._get_ai_eval_setting(config_key)

    def _get_ai_eval_setting(self, key: str):
        """
        Read a raw `ai_eval` setting: site configuration first, then global Django settings.

        Single source for the site->global precedence shared by API keys, model
        overrides, and the deprecated-model map.
        """
        if value := get_site_configuration_value(self.block_settings_key, key):
            return value
        return self._get_settings().get(key)

    def _learner_input_character_limit(self, key: str = "SHORTANSWER_CHARACTER_LIMIT") -> int:
        """
        Resolve the configured learner input character limit for this block.

        An absent setting falls back to the default silently. A value that is
        present but invalid is logged and ignored, so a bad setting can never
        break rendering for learners.
        """
        raw = self._get_ai_eval_setting(key)
        if raw is None:
            return self.DEFAULT_CHARACTER_LIMIT
        try:
            value = int(raw)
        except (TypeError, ValueError):
            logger.warning(
                "Ignoring invalid %s value %r; using the default of %d.",
                key,
                raw,
                self.DEFAULT_CHARACTER_LIMIT,
            )
            return self.DEFAULT_CHARACTER_LIMIT
        if value < 1:
            logger.warning(
                "Ignoring non-positive %s value %r; using the default of %d.",
                key,
                raw,
                self.DEFAULT_CHARACTER_LIMIT,
            )
            return self.DEFAULT_CHARACTER_LIMIT
        return value

    def _ai_eval_model_maps(self) -> dict:
        """
        Compute the maps that drive model overrides and alias resolution,
        so Studio renders and per-request lookups don't re-read site configuration for every slot.
        """
        cached = self.__dict__.get("_ai_eval_model_maps_cache")
        if cached is not None:
            return cached

        maps = model_maps()
        self.__dict__["_ai_eval_model_maps_cache"] = maps
        return maps

    def _resolve_model(self, model: str) -> str:
        """Resolve a possibly-retired model id to its replacement (the single config-aware entry point)."""
        return resolve_model(model, self._ai_eval_model_maps()["aliases"])

    def _model_slot(self, model: str | None = None) -> str | None:
        """
        Return the enum slot name (e.g. ``CLAUDE_SONNET``) a model id maps to, else None.

        Resolves retired ids and honors ``<NAME>_MODEL`` overrides, so provider-specific
        handling keyed on a slot keeps working when the slot's model id is overridden.
        Defaults to this block's stored ``model``.
        """
        model = self.model if model is None else model
        return self._ai_eval_model_maps()["slot_by_id"].get(self._resolve_model(model))

    def _effective_supported_models(self) -> list[str]:
        """Current model id for every supported slot, with operator overrides applied."""
        return list(self._ai_eval_model_maps()["effective"])

    def _get_model_config_key(self, model: str, config_parameter: str) -> str:
        """Build model configuration key name for site/global settings lookups."""
        # Resolve a retired id to its replacement, then map to the stable slot name.
        # Custom/unknown models fall back to a sanitized form of the id itself.
        resolved = self._resolve_model(model)
        slot_name = self._ai_eval_model_maps()["slot_by_id"].get(resolved)
        if slot_name is None:
            slot_name = resolved.replace("/", "_").replace("-", "_").upper()
        return f"{slot_name}_{config_parameter.upper()}"

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
        return self._get_ai_eval_setting(config_key)

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
        models = list(self._effective_supported_models())
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

    # Studio metadata helpers

    def _studio_lock_metadata(self) -> dict:
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

    def _studio_field_choices(self, field_name: str) -> list[dict[str, Any]]:
        """
        Return normalized choice metadata for a Studio-editable field.
        """
        field = self.fields[field_name]
        values_provider = getattr(field, "values_provider", None)
        if values_provider is None:
            runtime_options = getattr(field, "runtime_options", None) or {}
            values_provider = runtime_options.get("values_provider")
        values = None

        if callable(values_provider):
            values = values_provider(self)
        elif hasattr(field, "values"):
            values = field.values

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

    def _studio_field_metadata(self) -> dict[str, dict[str, Any]]:
        """
        Return field labels, help text, defaults, and choices for Studio.
        """
        metadata = {}

        for field_name in self.editable_fields:
            field = self.fields[field_name]
            metadata[field_name] = {
                "display_name": str(getattr(field, "display_name", field_name) or field_name),
                "help": str(getattr(field, "help", "") or ""),
                "default": getattr(field, "default", None),
                "choices": self._studio_field_choices(field_name),
            }

        return metadata

    def _studio_initial_state(self) -> dict[str, Any]:
        """
        Return current editable values for Studio payloads.
        """
        return {
            field_name: getattr(self, field_name)
            for field_name in self.editable_fields
        }

    def _studio_payload_meta(self) -> dict[str, Any]:
        """
        Return additive metadata for future Studio views.
        """
        return {
            "field_metadata": self._studio_field_metadata(),
            "lock_metadata": self._studio_lock_metadata(),
        }

    # Studio validation helpers

    def _add_studio_validation_error(
        self,
        validation_errors: dict[str, list[str]],
        field_name: str,
        message: str,
    ) -> None:
        """
        Append a structured field error used by the Studio contract.
        """
        validation_errors.setdefault(field_name, []).append(str(message))

    def _add_studio_validation_warning(
        self,
        validation_warnings: list[str],
        message: str,
    ) -> None:
        """
        Append a structured warning used by the Studio contract.
        """
        validation_warnings.append(str(message))

    def _collect_studio_validation_issues(
        self,
        data,
    ) -> tuple[dict[str, list[str]], list[str]]:
        """
        Return structured field errors and warnings for Studio saves.
        """
        validation_errors: dict[str, list[str]] = {}
        validation_warnings: list[str] = []
        llm_service = get_llm_service()

        use_custom_service = get_site_configuration_value("ai_eval", "USE_CUSTOM_LLM_SERVICE")
        if use_custom_service and llm_service and isinstance(llm_service, DefaultLLMService):
            self._add_studio_validation_warning(
                validation_warnings,
                _(
                    "Custom LLM service is enabled but using default models due to configuration issues. "
                    "Check logs for details."
                ),
            )

        usage_id = getattr(getattr(self, "scope_ids", None), "usage_id", None)
        if usage_id:
            cache_key = f"ai_eval:models_warn:{usage_id}"
            warning_msg = cache.get(cache_key)
            if warning_msg:
                self._add_studio_validation_warning(validation_warnings, warning_msg)

        if not data.model:
            self._add_studio_validation_error(
                validation_errors,
                "model",
                _("Model field is mandatory - please select one from the dropdown."),
            )

        if isinstance(llm_service, DefaultLLMService):
            if not self.get_model_api_key(data):
                self._add_studio_validation_error(
                    validation_errors,
                    "model_api_key",
                    _("Model API key is mandatory, if not set globally by your administrator."),
                )

            # Slot-aware so an overridden Llama model id still validates correctly.
            is_llama = self._model_slot(data.model) == SupportedModels.LLAMA.name

            if is_llama and not self.get_model_api_url(data):
                self._add_studio_validation_error(
                    validation_errors,
                    "model_api_url",
                    _(
                        "API URL field is mandatory when using ollama/llama2, "
                        "if not set globally by your administrator."
                    ),
                )

            if not is_llama and data.model_api_url:
                self._add_studio_validation_error(
                    validation_errors,
                    "model_api_url",
                    _("API URL field can be set only when using ollama/llama2."),
                )

        return validation_errors, validation_warnings

    def _clear_cached_studio_warnings(self) -> None:
        """
        Clear any short-lived validation warning cached during Studio metadata loading.
        """
        usage_id = getattr(getattr(self, "scope_ids", None), "usage_id", None)
        if usage_id:
            cache.delete(f"ai_eval:models_warn:{usage_id}")

    @staticmethod
    def _apply_studio_issues(
        validation,
        validation_errors: dict[str, list[str]],
        validation_warnings: list[str],
    ) -> None:
        """
        Convert structured Studio issues back into ValidationMessage objects.
        """
        for field_errors in validation_errors.values():
            for message in field_errors:
                validation.add(ValidationMessage(ValidationMessage.ERROR, message))

        for warning in validation_warnings:
            validation.add(ValidationMessage(ValidationMessage.WARNING, warning))

    # Frontend payload helpers

    def _build_view_payload(
        self,
        *,
        view: str,
        handler_urls: dict[str, str],
        initial_state: dict[str, Any],
        meta: dict[str, Any],
        style_urls: list[str],
    ) -> dict[str, Any]:
        """
        Return the normalized view payload shape used by future views.
        """
        return {
            "view": view,
            "handler_urls": handler_urls,
            "initial_state": initial_state,
            "meta": meta,
            "mfe_config_api": f"{settings.LMS_ROOT_URL}/api/mfe_config/v1?mfe=learning",
            "style_urls": [settings.LMS_ROOT_URL + self.runtime.local_resource_url(self, url) for url in style_urls],
        }

    @staticmethod
    def _studio_submit_response(
        success: bool,
        validation_errors: dict[str, Any] | None = None,
        validation_warnings: list[str] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Return the shared response shape planned for Studio saves.
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
        fragment.add_javascript_url(self.runtime.local_resource_url(self, "static/js/src/studio_api_key_lock.js"))
        fragment.initialize_js("AIEvalStudioEditor", self._studio_lock_metadata())
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
        validation_errors, validation_warnings = self._collect_studio_validation_issues(data)

        self._apply_studio_issues(
            validation,
            validation_errors,
            validation_warnings,
        )

        self._clear_cached_studio_warnings()

    @property
    def resolved_model(self) -> str:
        """
        The model identifier to use at runtime.

        Resolves any retired/renamed model saved on the block to its current
        replacement (code defaults plus the ``DEPRECATED_MODELS`` setting), so
        activities configured with a legacy model keep working without editing
        course content.
        """
        return self._resolve_model(self.model)

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
            self.resolved_model,
            self.get_model_api_key(),

            list(messages), self.get_model_api_url(),
            thread_id=prior_thread_id,
        )
        if tag and new_thread_id:
            tm = dict(getattr(self, "thread_map", {}) or {})
            tm[tag] = new_thread_id
            self.thread_map = tm
        return text

    def get_pdf_logo(self) -> str:
        """
        Return a logo for display in the header of generated PDFs.
        """
        configured_header_logo = get_site_configuration_value(self.block_settings_key, "PDF_HEADER_LOGO")
        footer_logo = getattr(settings, "FOOTER_OPENEDX_LOGO_IMAGE", "")
        return configured_header_logo or footer_logo or ""

    def build_pdf_response(self, content: CoachedData | CodingData | ShortAnswerData) -> Response:
        """
        Helper function to be called by the download pdf handlers in the child xblocks.
        """
        # https://openedx.atlassian.net/wiki/spaces/PLAT/pages/113607155/How+do+I+access+student+data+from+within+an+XBlock
        user = self.runtime.service(self, "user").get_current_user()
        user_email = user.emails[0] if user.emails else ""
        # Fallbacks because these user attributes are not guaranteed to be set.
        user_name = user.full_name or user.opt_attrs.get('edx-platform.username') or "Student"

        metadata = Metadata(
            info=Info(
                title=self.display_name,  # pylint: disable=no-member
            ),
            student=Student(email=user_email, name=user_name),
            branding=Branding(
                logo=self.get_pdf_logo(),
            ),
            location=get_pdf_location_nav(self),
        )
        pdf_data: bytes = generate_pdf(metadata, content)

        filename = slugify(f"{self.display_name}-{user_name}-transcript")  # pylint: disable=no-member
        return Response(
            pdf_data,
            content_type='application/pdf',
            content_disposition=f'attachment; filename="{filename}.pdf"',
        )
