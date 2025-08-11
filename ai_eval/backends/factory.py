"""Backend selection factory."""

import django.conf as django_conf
from .judge0 import Judge0Backend
from .custom import CustomServiceBackend


class BackendFactory:
    """
    Factory for creating code execution backends.
    """
    @classmethod
    def get_backend(cls, api_key: str = ""):
        """
        Get the appropriate backend based on Django settings.

        Args:
            api_key: Judge0 API key (only used for judge0 backend)

        Returns:
            CodeExecutionBackend: Configured backend instance
        """
        backend_config = getattr(
            django_conf.settings, 'AI_EVAL_CODE_EXECUTION_BACKEND', {}
        )

        if backend_config.get('backend') == 'custom':
            config = backend_config.get('custom_config', {})
            return CustomServiceBackend(
                submit_endpoint=config.get('submit_endpoint', ''),
                results_endpoint=config.get('results_endpoint', ''),
                languages_endpoint=config.get('languages_endpoint', ''),
                api_key=config.get('api_key', ''),
                timeout=config.get('timeout', 30),
                auth_header_name=config.get('auth_header_name', 'Authorization'),
                auth_scheme=config.get('auth_scheme', 'Bearer'),
            )

        # Default to judge0 backend
        judge0_config = backend_config.get('judge0_config', {})
        return Judge0Backend(
            api_key=api_key,
            base_url=judge0_config.get('base_url')
        )
