"""Tests for the signal receivers and how the plugin app connects them."""

import importlib
from types import SimpleNamespace
from unittest.mock import patch

from edx_django_utils.plugins import PluginSignals

from ai_eval.apps import AiEvalConfig
from ai_eval.signals import retire_learner_uploads


def test_retire_learner_uploads_receiver_calls_service():
    """The retirement receiver deletes the retired user's uploads."""
    with patch("ai_eval.upload_storage.retire_user_uploads", return_value=2) as retire_user_uploads:
        retire_learner_uploads(sender=None, user=SimpleNamespace(id=7))

    retire_user_uploads.assert_called_once_with(7)


def test_plugin_app_signal_config_points_at_receiver():
    """The LMS signal config connects the retirement signal to ``retire_learner_uploads``."""
    signal_config = AiEvalConfig.plugin_app[PluginSignals.CONFIG]

    assert list(signal_config) == ["lms.djangoapp"]
    lms_config = signal_config["lms.djangoapp"]
    receivers_module = importlib.import_module(f"ai_eval.{lms_config[PluginSignals.RELATIVE_PATH]}")
    [receiver] = lms_config[PluginSignals.RECEIVERS]
    assert getattr(receivers_module, receiver[PluginSignals.RECEIVER_FUNC_NAME]) is retire_learner_uploads
    assert receiver[PluginSignals.SIGNAL_PATH] == (
        "openedx.core.djangoapps.user_api.accounts.signals.USER_RETIRE_LMS_MISC"
    )
