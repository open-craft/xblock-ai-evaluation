"""Supported LLM model names and enumeration."""
import logging
from enum import Enum

from .compat import get_site_configuration_value

logger = logging.getLogger(__name__)

# Namespace under which all ai_eval operator settings live in site configuration.
AI_EVAL_SETTINGS_KEY = "ai_eval"


class SupportedModels(Enum):
    """
    LLM Models supported by the CodingAIEvalXBlock, ShortAnswerAIEvalXBlock,
    and CoachAIEvalXBlock.
    """

    GPT4O = "gpt-4o"
    GPT4O_MINI = "gpt-4o-mini"
    GEMINI_PRO = "gemini/gemini-pro"
    CLAUDE_SONNET = "claude-sonnet-4-6"
    LLAMA = "ollama/llama2"

    @staticmethod
    def list():
        """Return the list of supported model values."""
        return [str(m.value) for m in SupportedModels]


# Models retired or renamed by their providers, mapped to their drop-in
# replacement. Activities saved with a legacy identifier keep working because
# the value is resolved to its replacement at the point of use (the provider
# call and the per-model API-key lookup), so no course content needs editing.
LEGACY_MODEL_ALIASES = {
    "claude-sonnet-4-20250514": SupportedModels.CLAUDE_SONNET.value,
}


def resolve_model(model: str, aliases: dict | None = None) -> str:
    """
    Resolve a possibly-legacy model identifier to its current replacement.

    ``aliases`` defaults to the in-code :data:`LEGACY_MODEL_ALIASES`. Callers pass
    :func:`deprecated_model_aliases` to also honor the ``DEPRECATED_MODELS`` setting.
    """
    if aliases is None:
        aliases = LEGACY_MODEL_ALIASES
    seen = set()
    while model in aliases and model not in seen:
        seen.add(model)
        model = aliases[model]
    return model


def _slot_model(member: "SupportedModels") -> str:
    """Effective model id for one slot: the site-config ``<NAME>_MODEL`` override, else the default."""
    override = get_site_configuration_value(AI_EVAL_SETTINGS_KEY, f"{member.name}_MODEL")
    if override is not None:
        override = str(override).strip()
        if override:
            return override
    return member.value


def deprecated_model_aliases() -> dict:
    """Retired-id -> replacement: code ``LEGACY_MODEL_ALIASES`` overlaid with site-config ``DEPRECATED_MODELS``."""
    aliases = dict(LEGACY_MODEL_ALIASES)
    configured = get_site_configuration_value(AI_EVAL_SETTINGS_KEY, "DEPRECATED_MODELS")
    if isinstance(configured, dict):
        aliases.update(configured)
    elif configured:
        logger.warning("ai_eval DEPRECATED_MODELS setting is not a mapping; ignoring it.")
    return aliases


def model_maps() -> dict:
    """
    Compute the override/alias maps in a single pass.

    - ``effective``: effective model id per slot (override or default), in dropdown order.
    - ``slot_by_id``: ``{model_id: slot_name}``; enum defaults are inserted first and win,
      so an override can never hijack a built-in model's slot (and thus its ``<SLOT>_API_KEY``).
    - ``aliases``: retired-id -> replacement (see :func:`deprecated_model_aliases`).
    """
    effective = []
    slot_by_id = {member.value: member.name for member in SupportedModels}
    for member in SupportedModels:
        value = _slot_model(member)
        effective.append(value)
        slot_by_id.setdefault(value, member.name)
    return {"effective": effective, "slot_by_id": slot_by_id, "aliases": deprecated_model_aliases()}


def effective_supported_models() -> list:
    """Effective model id per supported slot (site-config overrides applied), in dropdown order."""
    return model_maps()["effective"]
