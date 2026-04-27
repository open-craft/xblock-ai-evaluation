"""Global test settings and fixtures."""
import pytest
import time_machine


@pytest.fixture(autouse=True)
def use_utc_tz(settings):
    """Override the django timezone to be UTC.

    For consistency in tests and to play nice with freezing time with time_machine.
    """
    settings.TIME_ZONE = "UTC"


# https://time-machine.readthedocs.io/en/latest/usage.html#time_machine.naive_mode
# Ensure any accidental naive dates in frozen time are caught. This helps reproducibility of tests.
time_machine.naive_mode = time_machine.NaiveMode.ERROR
