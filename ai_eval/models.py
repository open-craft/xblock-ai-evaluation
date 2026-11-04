"""Database models for the AI Evaluation XBlocks."""

import uuid

from django.db import models


class LearnerUpload(models.Model):
    """
    A file a learner uploaded to an AI block, and where its bytes are stored.

    Rows are the source of truth for which files exist, who owns them and
    whether they're still pending. Which message and session a file belongs to
    lives in the block's user state, so there is no session column.
    """

    class Pane(models.TextChoices):
        SHORTANSWER = "shortanswer"
        WORKSPACE = "workspace"
        COACH = "coach"

    class State(models.TextChoices):
        PENDING = "pending"
        SENT = "sent"

    upload_id = models.UUIDField(unique=True, default=uuid.uuid4, editable=False)
    # A plain integer, not a foreign key: used only for ownership checks and retirement.
    user_id = models.IntegerField()
    # ``str()`` of the opaque keys, so the package's tests don't depend on ``opaque_keys.edx.django``.
    course_key = models.CharField(max_length=255)
    usage_key = models.CharField(max_length=255)
    pane = models.CharField(max_length=16, choices=Pane.choices)
    # Where the bytes live in storage. Never leaves the server.
    storage_path = models.CharField(max_length=1024)
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=64)
    size = models.PositiveIntegerField()
    # No reader yet: recorded so duplicates can be removed later without a data migration.
    sha256 = models.CharField(max_length=64)
    state = models.CharField(max_length=8, choices=State.choices, default=State.PENDING)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Every query filters by user first (retirement by ``user_id`` alone), so one index covers them all.
        indexes = [
            models.Index(fields=["user_id", "usage_key", "pane", "state"]),
        ]

    def __str__(self):
        return str(self.upload_id)
