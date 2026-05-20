"""Global test settings and fixtures."""
import pytest


@pytest.fixture(autouse=True)
def add_lms_settings(settings):
    """Set common settings that are available on the LMS"""
    settings.LMS_ROOT_URL = "http://local.openedx.io:8000"
