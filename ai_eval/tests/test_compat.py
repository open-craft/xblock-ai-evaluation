"""Tests for compatibility layer."""

from unittest.mock import patch

import pytest
from django.test import override_settings

from ai_eval.compat import get_site_configuration_value, is_masquerading_as_specific_learner


@pytest.mark.parametrize(
    "site_configuration_value, expected_key",
    [
        ({}, None),
        ({"api_key": "test_key"}, "test_key"),
    ],
)
@patch("ai_eval.compat._get_current_site_configuration_value")
@override_settings(SERVICE_VARIANT="lms")
def test_get_site_configuration_value_in_lms(
    mock_get_current_site_configuration_value, site_configuration_value, expected_key
):
    """Test API key retrieval in different contexts."""
    block_settings_key = "block_settings"
    mock_get_current_site_configuration_value.return_value = site_configuration_value

    result = get_site_configuration_value(block_settings_key, "api_key")

    mock_get_current_site_configuration_value.assert_called_once_with(block_settings_key, {})
    assert result == expected_key


@pytest.mark.parametrize(
    "cms_site_configuration_value, lms_site_configuration_value, expected_key",
    [
        # LMS_BASE is not defined in site configuration, so it should be retrieved from settings.
        (None, {}, None),
        # LMS_BASE is defined in site configuration, so it should be retrieved from there.
        ("site.example.com", {"api_key": "test_key"}, "test_key"),
    ],
)
@patch("ai_eval.compat._get_site_configuration_value")
@patch("ai_eval.compat._get_current_site_configuration_value")
@override_settings(LMS_BASE="settings.example.com")
def test_get_site_configuration_value_in_cms(
    mock_get_current_site_configuration_value,
    mock_get_site_configuration_value,
    lms_site_configuration_value,
    cms_site_configuration_value,
    expected_key,
):
    """Test API key retrieval in different contexts."""
    block_settings_key = "block_settings"
    settings_lms_base = "settings.example.com"
    mock_get_current_site_configuration_value.return_value = cms_site_configuration_value
    mock_get_site_configuration_value.return_value = lms_site_configuration_value

    result = get_site_configuration_value(block_settings_key, "api_key")

    mock_get_current_site_configuration_value.assert_called_once_with("LMS_BASE", settings_lms_base)
    mock_get_site_configuration_value.assert_called_once_with(cms_site_configuration_value, block_settings_key, {})
    assert result == expected_key


def test_is_masquerading_as_specific_learner_false_outside_a_request():
    """Without a current request (for example, in a Celery task) there is no masquerade to check."""
    assert not is_masquerading_as_specific_learner(course_key=None)
