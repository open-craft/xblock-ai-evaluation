"""Abstract interfaces for code execution backends."""

from abc import ABC, abstractmethod
from typing import Dict, Any


class CodeExecutionBackend(ABC):
    """
    Abstract base class for code execution backends.
    """
    @abstractmethod
    def submit_code(self, code: str, language_label: str) -> str:
        """
        Submit code for execution.

        Args:
            code: The source code to execute
            language_label: Human-readable language label (e.g., "Python (3.8.1)").
                Implementations map this to their own representation.

        Returns:
            str: Submission ID for retrieving results
        """

    @abstractmethod
    def get_result(self, submission_id: str) -> Dict[str, Any]:
        """
        Get execution result for a submission.

        Args:
            submission_id: The submission ID from submit_code()

        Returns:
            dict: Execution result containing:
                - status: dict with 'id' and 'description'
                - stdout: str or None
                - stderr: str or None
                - compile_output: str or None
        """
