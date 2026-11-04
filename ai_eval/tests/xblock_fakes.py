"""Fake runtime, user and keys for constructing the AI blocks in tests."""

from dataclasses import dataclass

from xblock.fields import ScopeIds
from xblock.test.toy_runtime import ToyRuntime as _ToyRuntime

LEARNER_USER_ID = 7
LEARNER_ANONYMOUS_ID = "anonymous-learner"
COURSE_KEY = "course-v1:OpenCraft+AI101+2026"


class FakeUser():
    """A fake hardcoded user object for use with the local runtime."""
    emails = ["testuser@example.com"]
    full_name = "Test User"
    opt_attrs = {
        "edx-platform.user_id": LEARNER_USER_ID,
        "edx-platform.anonymous_user_id": LEARNER_ANONYMOUS_ID,
    }


class FakeUserService:
    """A fake user service for use with the local runtime."""
    def get_current_user(self):
        return FakeUser()


class ToyRuntime(_ToyRuntime):  # pylint: disable=abstract-method
    """A toy xblock runtime that adds a user service."""
    def __init__(self, user_id=None):
        super().__init__(user_id)
        self._services["user"] = FakeUserService()


class StudioPreviewRuntime(ToyRuntime):  # pylint: disable=abstract-method
    """
    A runtime like Studio's preview: the block is bound to the author's user ID,
    and the runtime is marked ``is_author_mode``.
    """
    is_author_mode = True


@dataclass(frozen=True)
class FakeUsageKey:
    """Stands in for an opaque-keys usage key: its string form and its ``course_key``."""

    block_id: str
    course_key: str = COURSE_KEY

    def __str__(self):
        return f"block-v1:{self.course_key.removeprefix('course-v1:')}+type@ai_eval+block@{self.block_id}"


def learner_scope_ids(block_type, block_id="first"):
    """Scope IDs of a block rendered for a learner in the LMS."""
    return ScopeIds("learner", block_type, block_id, FakeUsageKey(block_id))
