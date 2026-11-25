"""
Signal receivers for the AI Evaluation XBlocks.

They are connected through ``AiEvalConfig.plugin_app`` with dotted signal
paths, so nothing here imports edx-platform.
"""

import logging

logger = logging.getLogger(__name__)


def retire_learner_uploads(sender, user, **kwargs):  # pylint: disable=unused-argument
    """Delete every uploaded file and LearnerUpload row for a retired user."""
    from .upload_storage import retire_user_uploads  # pylint: disable=import-outside-toplevel
    retired_count = retire_user_uploads(user.id)
    logger.info("Retired %d learner uploads for user %s", retired_count, user.id)
