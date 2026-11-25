"""Django app configuration for the AI Evaluation XBlocks."""

from django.apps import AppConfig
from edx_django_utils.plugins import PluginSignals


class AiEvalConfig(AppConfig):
    """
    Registers ``ai_eval`` as an Open edX plugin app in the LMS and Studio.

    The app owns the ``LearnerUpload`` table. It is registered in Studio too,
    because the blocks load there and use the upload functions.
    """

    name = "ai_eval"
    verbose_name = "AI Evaluation XBlocks"
    default_auto_field = "django.db.models.BigAutoField"

    plugin_app = {
        PluginSignals.CONFIG: {
            # Retirement runs through the LMS ``retire_misc`` API, so the receiver is LMS-only.
            "lms.djangoapp": {
                PluginSignals.RELATIVE_PATH: "signals",
                PluginSignals.RECEIVERS: [
                    {
                        PluginSignals.RECEIVER_FUNC_NAME: "retire_learner_uploads",
                        PluginSignals.SIGNAL_PATH: (
                            "openedx.core.djangoapps.user_api.accounts.signals.USER_RETIRE_LMS_MISC"
                        ),
                    },
                ],
            },
        },
    }
