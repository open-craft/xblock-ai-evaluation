"""Supported LLM model names and enumeration."""
from enum import Enum


class SupportedModels(Enum):
    """
    LLM Models supported by the CodingAIEvalXBlock, ShortAnswerAIEvalXBlock,
    and MultiAgentAIEvalXBlock.
    """

    GPT4O = "gpt-4o"
    GPT4O_MINI = "gpt-4o-mini"
    GEMINI_PRO = "gemini/gemini-pro"
    CLAUDE_SONNET = "claude-sonnet-4-20250514"
    LLAMA = "ollama/llama2"

    @staticmethod
    def list():
        """Return the list of supported model values."""
        return [str(m.value) for m in SupportedModels]
