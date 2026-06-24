"""Global test settings and fixtures."""
from unittest.mock import patch

import pytest
import time_machine


@pytest.fixture(autouse=True)
def add_lms_settings(settings):
    """Set common settings that are available on the LMS"""
    settings.LMS_ROOT_URL = "http://local.openedx.io:8000"


@pytest.fixture(autouse=True)
def default_model_site_config():
    """
    Model overrides (``<NAME>_MODEL``) and ``DEPRECATED_MODELS`` are read from site
    configuration in ``ai_eval.supported_models``. Default those reads to "unset" so
    tests that don't configure overrides don't reach the (unavailable) Open edX
    site-config backend. Tests needing specific values patch the same target.
    """
    with patch("ai_eval.supported_models.get_site_configuration_value", return_value=None):
        yield


@pytest.fixture(autouse=True)
def use_utc_tz(settings):
    """Override the django timezone to be UTC.

    For consistency in tests and to play nice with freezing time with time_machine.
    """
    settings.TIME_ZONE = "UTC"


# https://time-machine.readthedocs.io/en/latest/usage.html#time_machine.naive_mode
# Ensure any accidental naive dates in frozen time are caught. This helps reproducibility of tests.
time_machine.naive_mode = time_machine.NaiveMode.ERROR
