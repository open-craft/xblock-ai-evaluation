"""Supported LLM model names and enumeration."""
from enum import Enum


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
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
}


def resolve_model(model: str) -> str:
    """Resolve a possibly-legacy model identifier to its current replacement."""
    return LEGACY_MODEL_ALIASES.get(model, model)
