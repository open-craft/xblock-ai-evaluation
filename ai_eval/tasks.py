"""
Celery task for student messages export.
"""
import itertools
import time

from celery import shared_task
from celery.utils.log import get_task_logger
from django.contrib.auth import get_user_model
from xblock.fields import Scope

from . import (
    coding_ai_eval,
    CodingAIEvalXBlock,
    CoachAIEvalXBlock,
    ShortAnswerAIEvalXBlock,
)

logger = get_task_logger(__name__)

User = get_user_model()

_BASE_HEADER = (
    "Course Name",
    "Section",
    "Subsection",
    "Unit",
    "Location",
    "Display Name",
    "Username",
    "User E-mail",
    "Conversation",
    "Source",
    "Message",
)

_BLOCK_CATEGORIES = [
    'coding_ai_eval',
    'coach_ai_eval',
    'shortanswer_ai_eval',
]


def _get_course_display_name(course_id):
    """
    Return a human-readable course title for `course_id`.

    Best-effort: on any error, fall back to `str(course_id)`.
    """
    for getter in (
        _get_course_display_name_from_course_overview,
        _get_course_display_name_from_modulestore,
    ):
        try:
            display_name = getter(course_id)
        except Exception:  # pylint: disable=broad-exception-caught
            display_name = None
        if display_name:
            return str(display_name)
    return str(course_id)


def _get_course_display_name_from_course_overview(course_id):
    """
    Get course name from course overview
    """
    # pylint: disable=import-error,import-outside-toplevel
    from openedx.core.djangoapps.content.course_overviews.models import CourseOverview

    overview = CourseOverview.get_from_id(course_id)
    return getattr(overview, "display_name", None)


def _get_course_display_name_from_modulestore(course_id):
    """
    Get course name from modulestore
    """
    # pylint: disable=import-error,import-outside-toplevel
    from xmodule.modulestore.django import modulestore

    course = modulestore().get_course(course_id)
    return getattr(course, "display_name", None) or getattr(
        course, "display_name_with_default", None
    )


def _build_export_rows(course_display_name, data_rows_iter):
    """
    Build an export row iterator, prefixing each row with `course_display_name`.
    """
    header = _BASE_HEADER
    prefixed_data_rows = ((course_display_name,) + row for row in data_rows_iter)
    return itertools.chain([header], prefixed_data_rows)


@shared_task()
def export_data(course_id_str):
    """
    Exports chat logs from all supported XBlocks.
    """
    # pylint: disable=import-error,import-outside-toplevel
    from common.djangoapps.util.file import course_filename_prefix_generator
    from lms.djangoapps.instructor_task.models import ReportStore
    from opaque_keys.edx.keys import CourseKey

    start_timestamp = time.time()

    course_id = CourseKey.from_string(course_id_str)
    course_display_name = _get_course_display_name(course_id)

    logger.debug("Beginning data export")

    rows = _build_export_rows(course_display_name, _extract_all_data(course_id))

    report_store = ReportStore.from_config(config_name='GRADES_DOWNLOAD')

    timestamp = time.strftime("%Y-%m-%d-%H%M%S", time.gmtime(start_timestamp))
    filename = "ai_eval_history-{course_prefix}-{timestamp_str}.csv".format(
        course_prefix=course_filename_prefix_generator(course_id),
        timestamp_str=timestamp
    )
    report_store.store_rows(course_id, filename, rows)

    generation_time_s = time.time() - start_timestamp
    logger.debug(f"Done data export - took {generation_time_s} seconds")

    return {
        "report_filename": filename,
        "start_timestamp": start_timestamp,
        "generation_time_s": generation_time_s,
    }


def _extract_all_data(course_id):
    """Extract data for all XBlocks supported in this package."""
    # pylint: disable=import-error,import-outside-toplevel
    from xmodule.modulestore.django import modulestore

    store = modulestore()
    for category in _BLOCK_CATEGORIES:
        for block in store.get_items(
            course_id,
            qualifiers={'category': category},
        ):
            yield from _extract_data(block)


def _get_messages(block, session):
    """Extract messages for one conversation session of a supported XBlock."""
    if isinstance(block, CodingAIEvalXBlock):
        yield ("user", session[coding_ai_eval.USER_RESPONSE])
        yield ("ai_evaluation", session[coding_ai_eval.AI_EVALUATION])
        yield ("code_exec_result", session[coding_ai_eval.CODE_EXEC_RESULT])
    else:
        for message in session:
            if isinstance(block, ShortAnswerAIEvalXBlock):
                source = message["source"]
                content = message["content"]
            else:
                continue
            yield (source, content)


def _get_user_state_value(field_data_cache, block, user, field_name, default=None):
    """
    Fetch user state value for required field.
    """
    # pylint: disable=import-error,import-outside-toplevel
    from lms.djangoapps.courseware.model_data import DjangoKeyValueStore

    try:
        return field_data_cache.get(
            DjangoKeyValueStore.Key(
                scope=Scope.user_state,
                user_id=user.id,
                block_scope_id=block.location,
                field_name=field_name,
            )
        )
    except KeyError:
        return default


def _iter_coach_messages(block, workspace_history, coach_history, evaluation_fragments):
    """
    Yield (source, content) tuples for CoachAIEvalXBlock user state.

    Ordering is best-effort: workspace first, then coach, then evaluation fragments.
    """
    main_role = block.character_1_role or "Main character"
    coach_role = block.character_2_role or "Coach"

    def _iter_fragments(fragments, assistant_role):
        for fragment in fragments or []:
            fragment = fragment or {}
            user_message = fragment.get("user_message") or ""
            if user_message.strip():
                yield ("user", user_message)
            character_message = fragment.get("character_message") or ""
            if character_message.strip():
                yield (f"llm ({assistant_role})", character_message)

    yield from _iter_fragments(workspace_history, main_role)
    yield from _iter_fragments(coach_history, coach_role)
    for fragment in evaluation_fragments or []:
        fragment = fragment or {}
        character_message = fragment.get("character_message") or ""
        if character_message.strip():
            yield ("llm (Evaluator)", character_message)


def _extract_data(block):
    """Extract data for one XBlock."""
    # pylint: disable=import-error,import-outside-toplevel
    from common.djangoapps.student.models import CourseEnrollment
    from lms.djangoapps.courseware.model_data import (
        DjangoKeyValueStore,
        FieldDataCache,
    )

    section_name, subsection_name, unit_name = _get_context(block)

    for user in CourseEnrollment.objects.users_enrolled_in(str(block.course_id)):
        data = FieldDataCache([], block.course_id, user)
        data.add_blocks_to_cache([block])

        if isinstance(block, CoachAIEvalXBlock):
            workspace_history = _get_user_state_value(
                data, block, user, "workspace_history", default=[]
            )
            coach_history = _get_user_state_value(
                data, block, user, "coach_history", default=[]
            )
            evaluation_fragments = _get_user_state_value(
                data, block, user, "evaluation_fragments", default=[]
            )
            if not workspace_history and not coach_history and not evaluation_fragments:
                continue
            for source, content in _iter_coach_messages(
                block, workspace_history, coach_history, evaluation_fragments
            ):
                yield (
                    section_name,
                    subsection_name,
                    unit_name,
                    str(block.location),
                    block.display_name,
                    user.username,
                    user.email or "",
                    None,
                    source,
                    content,
                )
        else:
            try:
                sessions = data.get(DjangoKeyValueStore.Key(
                    scope=Scope.user_state,
                    user_id=user.id,
                    block_scope_id=block.location,
                    field_name='sessions'
                ))
            except KeyError:
                continue

            for idx, session in enumerate(sessions, start=1):
                for source, content in _get_messages(block, session):
                    yield (
                        section_name,
                        subsection_name,
                        unit_name,
                        str(block.location),
                        block.display_name,
                        user.username,
                        user.email or "",
                        idx,
                        source,
                        content,
                    )


def _get_context(block):
    """
    Return section, subsection, and unit names for `block`.
    """
    block_names_by_type = {}
    block_iter = block
    while block_iter:
        block_iter_type = block_iter.scope_ids.block_type
        block_names_by_type[block_iter_type] = block_iter.display_name_with_default
        block_iter = block_iter.get_parent() if block_iter.parent else None
    section_name = block_names_by_type.get('chapter', '')
    subsection_name = block_names_by_type.get('sequential', '')
    unit_name = block_names_by_type.get('vertical', '')
    return section_name, subsection_name, unit_name
