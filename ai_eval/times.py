from datetime import datetime, UTC, timezone

# These are fallback times to make it easier to work with and order old data that doesn't have times.
# coach messages should be displayed before workspace messages
# For any message with these times, the times should not be displayed to the user (because they're fake times).
FALLBACK_COACH_MESSAGE_TIME = datetime(1975, 1, 1, tzinfo=UTC).isoformat()
FALLBACK_WORKSPACE_MESSAGE_TIME = datetime(1976, 1, 1, tzinfo=UTC).isoformat()


def now() -> datetime:
    """Return a timezone aware datetime for the current instant, in the local timezone."""
    return datetime.now().astimezone()


def pretty_time(value: datetime) -> str:
    """
    Jinja filter to get a human readable date with a consistent format.

    This is used to display date values in the PDFs.
    """
    # See https://docs.python.org/3/library/datetime.html#strftime-and-strptime-format-codes for formatting help.
    print(value)
    return value.strftime("%d %B %Y, %I:%M%p %Z")
