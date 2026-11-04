"""Django app configuration for the AI Evaluation XBlocks."""

from django.apps import AppConfig


class AiEvalConfig(AppConfig):
    """
    Registers ``ai_eval`` as an Open edX plugin app in the LMS and Studio.

    The app owns the ``LearnerUpload`` table. It is registered in Studio too,
    because the blocks load there and use the upload functions.
    """

    name = "ai_eval"
    verbose_name = "AI Evaluation XBlocks"
    default_auto_field = "django.db.models.BigAutoField"
