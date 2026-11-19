"""Test settings: the workbench settings plus the ``ai_eval`` Django app."""

from workbench.settings import *  # pylint: disable=wildcard-import,unused-wildcard-import  # noqa: F401,F403

INSTALLED_APPS = [*INSTALLED_APPS, "ai_eval"]  # noqa: F405
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
