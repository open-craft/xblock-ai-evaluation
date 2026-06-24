"""Compatibility layer for Open edX."""

import logging
from typing import Any

from django.conf import settings

from .pdf_generator import Location

logger = logging.getLogger(__name__)


def _get_current_site_configuration_value(key: str, default: Any = None) -> Any:  # pragma: no cover
    """
    Get value from the current site configuration.

    Args:
        key: The key to retrieve from the site configuration.
        default: The default value to return if the key is not found.
    Returns:
        The value associated with the key, or the default value.
    """
    # pylint: disable=import-error,import-outside-toplevel
    from openedx.core.djangoapps.site_configuration.helpers import get_value

    return get_value(key, default)


def _get_site_configuration_value(domain: str, key: str, default: Any = None) -> Any:  # pragma: no cover
    """
    Get value from the site configuration for a given domain.

    Args:
        domain: The domain to retrieve site configuration for.
        key: The key to retrieve from the site configuration.
        default: The default value to return if the key is not found.

    Returns:
        The value associated with the key, or the default value.
    """
    # pylint: disable=import-error,import-outside-toplevel
    from openedx.core.djangoapps.site_configuration.models import SiteConfiguration

    try:
        config = SiteConfiguration.objects.get(site__domain=domain).site_values
        return config.get(key, default)
    except SiteConfiguration.DoesNotExist:
        return default


def get_site_configuration_value(block_settings_key: str, config_key: str) -> str | None:
    """
    Retrieve configuration value from site configuration based on execution context.

    In Open edX, site configurations are defined separately for LMS and CMS (Studio)
    environments. API keys are typically stored in the LMS site configuration.
    This function handles the different contexts:

    In LMS: Get the API key directly from the current site configuration.
    In CMS: Get the API key using LMS site configuration.
        The LMS domain is retrieved from CMS site configuration or Django settings.

    This special handling is necessary because when an XBlock is being edited in Studio,
    it needs to access API keys that are stored in the corresponding LMS site configuration,
    not in the Studio site configuration.

    Args:
        block_settings_key: The key under which block settings are stored.
        config_key: Configuration key to retrieve.

    Returns:
        The configuration value if found, None otherwise.
    """
    if getattr(settings, "SERVICE_VARIANT", None) == "lms":
        block_config = _get_current_site_configuration_value(block_settings_key, {})
        return block_config.get(config_key)

    lms_base = _get_current_site_configuration_value("LMS_BASE", getattr(settings, "LMS_BASE", None))
    block_config = _get_site_configuration_value(lms_base, block_settings_key, {})
    return block_config.get(config_key)


def get_pdf_location_nav(xblock: "XBlock") -> Location | None:
    """
    Build and return the structured hierarchy of location information for this xblock.

    Return None if an error is encountered that indicates the current runtime doesn't support this
    or the xblock isn't in a standard course hierarchy (eg. a content library).
    """
    try:
        unit = xblock.get_parent()
        subsection = unit.get_parent()
        section = subsection.get_parent()
        course = section.get_parent()
    except Exception:  # pylint: disable=broad-exception-caught
        logger.warning(
            "Failed to retrieve location hierarchy information, "
            "possibly not running in openedx-platform runtime or from within a course. Skipping."
        )
        return None

    lms_root_url = _get_current_site_configuration_value('LMS_ROOT_URL', settings.LMS_ROOT_URL)
    unit_url = f"{lms_root_url}/courses/{course.id}/jump_to/{unit.location}"
    subsection_url = f"{lms_root_url}/courses/{course.id}/jump_to/{subsection.location}"
    section_url = f"{lms_root_url}/courses/{course.id}/jump_to/{section.location}"
    course_url = f"{lms_root_url}/courses/{course.id}/"

    return Location(
        course_name=course.display_name,
        course_url=course_url,
        section_name=section.display_name,
        section_url=section_url,
        subsection_name=subsection.display_name,
        subsection_url=subsection_url,
        unit_name=unit.display_name,
        unit_url=unit_url,
    )
