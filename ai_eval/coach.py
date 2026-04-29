"""Multi-agent AI XBlock."""

import hashlib
import json
import re
import textwrap
import typing

import jinja2
import pydantic
from django.utils.translation import gettext_noop as _
from jinja2.sandbox import SandboxedEnvironment
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Boolean, Dict, Integer, List, Scope, String
from xblock.utils.resources import ResourceLoader
from xblock.utils.studio_editable import FutureFields
from web_fragments.fragment import Fragment
from webob import Response

from .base import AIEvalXBlock
from .llm import get_llm_service
from .llm_services import CustomLLMService
from .supported_models import SupportedModels
from .pdf_generator import CoachedData, CoachedSection, CoachedMessage
from .utils import now, FALLBACK_COACH_MESSAGE_TIME, FALLBACK_WORKSPACE_MESSAGE_TIME


resource_loader = ResourceLoader(__name__)

SAMPLE_CHARACTER_PROMPT = textwrap.dedent("""
    You are {{ character_data.name }}.
    In the given conversation, you are speaking to the student.

    Personality details:
    Key competencies:
    Behavioral profile:

    Case Details: {{ scenario_data.case_details }}
    Learning Objectives: {{ scenario_data.learning_objectives }}
    Evaluation Criteria: {{ scenario_data.evaluation_criteria }}

    Speak in a dialogue fashion, naturally and succinctly.
    Do not do the work for the student. If the student tries to get you to answer the questions you are asking them to supply information on, redirect them to the task.
    Do not present tables, lists, or detailed written explanations. For instance, do not say 'the main goals include: 1. ...'
    Output only the text content of the next message from {{ character_data.name }}.
""").strip()  # noqa


DEFAULT_EVALUATOR_PROMPT = textwrap.dedent("""
    You are an evaluator agent responsible for generating an evaluation report of the conversation after the conversation has concluded.
    Use the provided chat history to evaluate the learner based on the evaluation criteria.
    You are evaluating the user based on their input, not the reactions by the other characters (such as the main character or the coach).
    **Important**: Your only job is to give an evaluation report in well-structured markdown. You are not to chat with the learner. Do not engage in any conversation or provide feedback directly to the user. Do not ask questions, give advice or encouragement, or continue the conversation. Your only job is to produce the evaluation report.
    Your task is to produce a well-structured markdown report in the following format:

    # Evaluation Report

    {% for criterion in scenario_data.evaluation_criteria %}
        ## {{ criterion.name }}
        ### Score: (0-5)/5
        **Rationale**: Provide a rationale for the score, using specific direct quotes from the conversation as evidence.
    {% endfor %}

    Your response must adhere to this exact structure, and each score must have a detailed rationale that includes at least one direct quote from the chat history.
    If you cannot find a direct quote, mention this explicitly and provide an explanation.
""").strip()  # noqa


DEFAULT_CONVERSATION_FORMAT = textwrap.dedent("""
    <conversation>
        {% for message in messages %}
            <message>
                <agent>{{ message.character.name }}</agent>
                <role>{{ message.character.role }}</role>
                <content>{{ message.content | escape }}</content>
            </message>
        {% endfor %}
    </conversation>
""")


class EvaluationCriterion(pydantic.BaseModel):
    name: pydantic.StrictStr


class CoachScenarioData(pydantic.BaseModel):
    """Schema for the scenario_data XBlock field."""

    case_details: pydantic.StrictStr
    learning_objectives: typing.List[pydantic.StrictStr]
    evaluation_criteria: typing.List[EvaluationCriterion]

    @pydantic.model_validator(mode="before")
    @classmethod
    def check_is_dict(cls, data: typing.Any) -> typing.Any:
        """Reject non-dict input before field validation runs."""
        if not isinstance(data, dict):
            raise ValueError(
                "Scenario data must be a JSON object (dictionary)."
            )
        return data


class CoachingSession(pydantic.BaseModel):
    """Normalized shape of a single Coaching learner session."""

    workspace_history: list = pydantic.Field(default_factory=list)
    coach_history: list = pydantic.Field(default_factory=list)
    evaluation_fragments: list = pydantic.Field(default_factory=list)
    attempts_used: int = pydantic.Field(default=0, ge=0)
    finished: bool = False
    final_submission: str = ""
    final_evaluation_markdown: str = ""

    @pydantic.field_validator("workspace_history", "coach_history", "evaluation_fragments", mode="before")
    @classmethod
    def ensure_list(cls, v):
        """Accept only lists; replace anything else with an empty list."""
        return list(v) if isinstance(v, list) else []

    @pydantic.field_validator("attempts_used", mode="before")
    @classmethod
    def ensure_non_negative_int(cls, v):
        """Parse to a non-negative integer; default to 0 on failure."""
        try:
            return max(int(v or 0), 0)
        except (TypeError, ValueError):
            return 0

    @pydantic.field_validator("final_submission", "final_evaluation_markdown", mode="before")
    @classmethod
    def ensure_str(cls, v):
        """Accept truthy values as strings; default to empty string."""
        return str(v) if v else ""


_EMPTY_SESSION = CoachingSession().model_dump()


class CoachAIEvalXBlock(AIEvalXBlock):
    """

    AI-powered XBlock for simulated conversations with
    two simulated characters.

    """

    has_author_view = True

    _jinja_env = SandboxedEnvironment(
        undefined=jinja2.StrictUndefined,
        line_statement_prefix=None,
        line_comment_prefix=None,
    )

    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Coached AI Evaluation",
        scope=Scope.settings,
    )

    evaluator_prompt = String(
        display_name=_("Evaluator prompt"),
        help=_(""),
        multiline_editor=True,
        default=DEFAULT_EVALUATOR_PROMPT,
        scope=Scope.settings,
    )

    initial_message = String(
        display_name=_("Initial message"),
        help=_(
            "First message in the Workspace (left) pane from the main character. "
            "Markdown supported. Also sent to the model as the first assistant message."
        ),
        default="",
        scope=Scope.settings,
    )

    coach_initial_message = String(
        display_name=_("Coach initial message"),
        help=_(
            "First message in the Coach (right) pane. Markdown supported. "
            "Also sent to the coach model as the first assistant message."
        ),
        default="",
        scope=Scope.settings,
    )

    scenario_data = Dict(
        display_name=_("Scenario data"),
        help=_(
            "Structured scenario context for prompts (characters and evaluator). "
            "It provides the case background, learning objectives, and rubric the evaluator scores against. "
            "Expected keys: case_details (str), learning_objectives (list[str]), "
            "evaluation_criteria (list[{name: str}])."
        ),
        default={
            "case_details": (
                "A short example paragraph, as an exercise demonstrating creativity "
                "and good sentence structure. The topic does not matter."
            ),
            "learning_objectives": [
                "1 paragraph of 1-5 sentences.",
                "Demonstrate creative use of words.",
            ],
            "evaluation_criteria": [
                {"name": "Following instructions"},
                {"name": "Creativity"},
                {"name": "Sentence structure"},
            ],
        },
        scope=Scope.settings,
    )

    workspace_title = String(
        display_name=_("Workspace title"),
        help=_("Title shown above the left pane (main character)"),
        default=_("Add your answer"),
        scope=Scope.settings,
    )

    coach_title = String(
        display_name=_("Coach title"),
        help=_("Title shown above the right pane (coach)"),
        default=_("Coach"),
        scope=Scope.settings,
    )

    intro_text = String(
        display_name=_("Introductory text"),
        help=_(""),
        default="",
        scope=Scope.settings,
        multiline_editor=True,
    )

    character_1_avatar = String(
        display_name=_("Main character avatar URL"),
        help=_("URL for the main character (left pane) avatar image"),
        scope=Scope.settings,
        default="",
    )

    character_2_avatar = String(
        display_name=_("Coach avatar URL"),
        help=_("URL for the coach (right pane) avatar image"),
        scope=Scope.settings,
        default="",
    )

    character_1_name = String(
        display_name=_("Main character name"),
        help=_("Name of the main character (left pane)"),
        scope=Scope.settings,
        default="",
    )

    character_1_role = String(
        display_name=_("Main character role"),
        help=_("Role of the main character (left pane)"),
        scope=Scope.settings,
        default="Main character",
    )

    character_1_prompt = String(
        display_name=_("Main character prompt"),
        help=_(
            "Defines how the main character (left pane) behaves. "
            "You can use Jinja variables: character_data, scenario_data."
        ),
        multiline_editor=True,
        scope=Scope.settings,
        default=SAMPLE_CHARACTER_PROMPT,
    )

    character_2_name = String(
        display_name=_("Coach name"),
        help=_("Name of the coach (right pane)"),
        scope=Scope.settings,
        default="",
    )

    character_2_role = String(
        display_name=_("Coach role"),
        help=_("Role of the coach (right pane)"),
        scope=Scope.settings,
        default="Coach",
    )

    character_2_prompt = String(
        display_name=_("Coach prompt"),
        help=_(
            "Defines how the coach (right pane) behaves. "
            "You can use Jinja variables: character_data, scenario_data."
        ),
        multiline_editor=True,
        scope=Scope.settings,
        default=SAMPLE_CHARACTER_PROMPT,
    )

    conversation_format = String(
        display_name=_("Conversation format template"),
        help=_(
            "Template used to format the conversation, appended to all prompts"
        ),
        multiline_editor=True,
        default=DEFAULT_CONVERSATION_FORMAT,
        scope=Scope.settings,
    )

    message_content_tag = String(
        display_name=_("Message content tag"),
        help=_("Tag for finding message content in the model's response"),
        default="content",
        scope=Scope.settings,
    )

    blacklist = List(
        display_name=_("Output blacklist"),
        help=_(
            "List of words that, if present in the AI response, "
            "will cause the message to not be shown to the learner, "
            "displaying an error instead"
        ),
        scope=Scope.settings,
        # Prevent the LLM from breaking character and calling itself an AI
        # assistant if the user tries to subvert the plot.
        default=["AI assistant"],
    )

    finished = Boolean(
        scope=Scope.user_state,
        default=False,
    )

    workspace_history = List(
        scope=Scope.user_state,
        default=[],
    )

    coach_history = List(
        scope=Scope.user_state,
        default=[],
    )

    evaluation_fragments = List(
        scope=Scope.user_state,
        default=[],
    )

    attempts_used = Integer(
        scope=Scope.user_state,
        default=0,
    )

    final_submission = String(
        scope=Scope.user_state,
        default="",
    )

    final_evaluation_markdown = String(
        scope=Scope.user_state,
        default="",
    )

    sessions = List(
        scope=Scope.user_state,
        default=[],
    )

    max_attempts = Integer(
        display_name=_("Maximum attempts"),
        help=_("Total attempts a learner is allowed for evaluation"),
        default=3,
        scope=Scope.settings,
    )

    allow_reset = Boolean(
        display_name=_("Allow reset"),
        help=_(
            "If enabled, learners can reset the entire activity (both panes and attempts)."
        ),
        default=False,
        scope=Scope.settings,
    )

    editable_fields = AIEvalXBlock.editable_fields + (
        "initial_message",
        "coach_initial_message",
        "scenario_data",
        "workspace_title",
        "coach_title",
        "intro_text",
        "character_1_name",
        "character_1_role",
        "character_1_prompt",
        "character_1_avatar",
        "character_2_name",
        "character_2_role",
        "character_2_prompt",
        "character_2_avatar",
        "evaluator_prompt",
        "blacklist",
        "max_attempts",
        "allow_reset",
    )

    def studio_view(self, context=None):
        """Render the React Studio editor for Coaching."""
        # Ideally we shouldn't need to define any HTML as the React App StudioUI should take care of everything.
        # However, the Studio Runtime for the XBlock looks for certain elements in the DOM to render it's wrapper.
        #
        # So, "editor-with-buttons" is defined to prevent the footer nativations from showing up.
        fragment = Fragment('<div data-ai-eval-react-root="true" class="editor-with-buttons is-active"></div>')
        fragment.add_css(resource_loader.load_unicode("static/css/studio_fixes.css"))
        fragment.add_javascript_url(self.runtime.local_resource_url(self, "static/bundles/coaching.studio.js"))
        fragment.initialize_js(
            "CoachAIEvalXBlockStudio",
            self._build_view_payload(
                view="studio",
                handler_urls={
                    "studio_submit": self.runtime.handler_url(self, "studio_submit"),
                },
                initial_state=self._studio_initial_state(),
                meta=self._studio_payload_meta(),
                style_urls=[
                    "static/bundles/shared.css",
                    "static/css/studio_api_key_lock.css",
                    "static/css/shortanswer_studio.css",
                    "static/css/coach_studio.css",
                ]
            ),
        )
        return fragment

    def _render_template(self, template, **context):
        return self._jinja_env.from_string(template).render(context)

    def _get_field_display_name(self, field_name):
        return self.fields[field_name].display_name

    def _map_scenario_data_validation_error_field(
        self,
        location: tuple[typing.Any, ...],
    ) -> str:
        """Translate `scenario_data` schema errors into Studio field keys."""
        if not location:
            return "scenario_data"

        field_name = location[0]
        if field_name == "case_details":
            return "scenario_case_details"
        if field_name == "learning_objectives":
            return "scenario_learning_objectives"
        if field_name == "evaluation_criteria":
            return "scenario_evaluation_criteria"
        return "scenario_data"

    def _format_scenario_data_validation_error(
        self,
        error: dict[str, typing.Any],
    ) -> tuple[str, str]:
        """Return a Studio field key and author-facing validation message."""
        location = tuple(error.get("loc", ()))
        mapped_field = self._map_scenario_data_validation_error_field(location)

        # model_validator errors (e.g. "not a dict") carry their own message.
        if error.get("type") == "value_error" and not location:
            msg = str(error.get("ctx", {}).get("error", ""))
            if msg:
                return mapped_field, msg
            return mapped_field, _(
                "Scenario data must be a JSON object (dictionary)."
            )

        if mapped_field == "scenario_case_details":
            return mapped_field, _("Scenario must be a valid string.")

        if mapped_field == "scenario_learning_objectives":
            if len(location) > 1 and isinstance(location[1], int):
                return mapped_field, _(
                    "Learning objective {index} must be text."
                ).format(index=location[1] + 1)
            return mapped_field, _("Learning objectives must be a list of text items.")

        if mapped_field == "scenario_evaluation_criteria":
            if len(location) > 2 and location[2] == "name" and isinstance(location[1], int):
                return mapped_field, _(
                    "Evaluation criterion {index} must include a name."
                ).format(index=location[1] + 1)
            if len(location) > 1 and isinstance(location[1], int):
                return mapped_field, _(
                    "Evaluation criterion {index} must be a valid criterion."
                ).format(index=location[1] + 1)
            return mapped_field, _(
                "Evaluation criteria must be a list of criteria with names."
            )

        return mapped_field, _(
            "Scenario data structure is invalid. Expected keys: "
            "case_details (str), learning_objectives (list[str]), "
            "evaluation_criteria (list[{name: str}])."
        )

    def _get_template_validation_scenario_data(
        self,
        scenario_data: dict[str, typing.Any],
        has_schema_errors: bool,
    ) -> dict[str, typing.Any]:
        """Provide stable scenario data for template validation."""
        if not has_schema_errors:
            return scenario_data

        existing_scenario_data = getattr(self, "scenario_data", None)
        if isinstance(existing_scenario_data, dict):
            return existing_scenario_data

        return {
            "case_details": "",
            "learning_objectives": [],
            "evaluation_criteria": [],
        }

    @staticmethod
    def _sanitize_blacklist_values(values):
        """Drop empty blacklist entries while preserving meaningful terms."""
        if not isinstance(values, list):
            return values

        return [
            value
            for value in values
            if not (isinstance(value, str) and value.strip() == "")
        ]

    def _get_blacklist_terms(self):
        """Return normalized blacklist terms suitable for prompts and runtime checks."""
        values = self._sanitize_blacklist_values(self.blacklist)
        if not isinstance(values, list):
            return []
        return [value for value in values if isinstance(value, str)]

    def _build_blacklist_instruction(self):
        """Return a prompt instruction that steers the model away from blocked terms."""
        blacklist_terms = self._get_blacklist_terms()
        if not blacklist_terms:
            return ""

        joined_terms = ", ".join(f'"{term}"' for term in blacklist_terms)
        return (
            "Do not use any of these words or phrases in your response: "
            f"{joined_terms}."
        )

    def _collect_studio_validation_issues(
        self,
        data,
    ) -> tuple[dict[str, list[str]], list[str]]:
        """
        Extend base Studio validation issues with Coaching-specific rules.
        """
        validation_errors, validation_warnings = super()._collect_studio_validation_issues(data)
        scenario_data = data.scenario_data
        has_scenario_schema_errors = False

        try:
            CoachScenarioData.model_validate(scenario_data)
        except pydantic.ValidationError as e:
            has_scenario_schema_errors = True
            for error in e.errors():
                field_name, message = self._format_scenario_data_validation_error(error)
                self._add_studio_validation_error(
                    validation_errors,
                    field_name,
                    message,
                )

        if not isinstance(scenario_data, dict):
            scenario_data = {}
        template_scenario_data = self._get_template_validation_scenario_data(
            scenario_data,
            has_scenario_schema_errors,
        )

        # Validate templates early (StrictUndefined): catches missing keys/typos.
        try:
            self._render_template(
                data.conversation_format,
                messages=[{"character": {"name": "", "role": ""}, "content": ""}],
            )
        except jinja2.TemplateError as e:
            self._add_studio_validation_error(
                validation_errors,
                "conversation_format",
                str(e),
            )

        for prompt_field, pane in [
            ("character_1_prompt", "workspace"),
            ("character_2_prompt", "coach"),
        ]:
            try:
                self._render_template(
                    getattr(data, prompt_field),
                    character_data={
                        "name": "",
                        "role": "",
                        "avatar": "",
                        "pane": pane,
                    },
                    scenario_data=template_scenario_data,
                )
            except jinja2.TemplateError as e:
                self._add_studio_validation_error(
                    validation_errors,
                    prompt_field,
                    str(e),
                )

        try:
            self._render_template(data.evaluator_prompt, scenario_data=template_scenario_data)
        except jinja2.TemplateError as e:
            self._add_studio_validation_error(
                validation_errors,
                "evaluator_prompt",
                str(e),
            )

        return validation_errors, validation_warnings

    def validate_field_data(self, validation, data):
        """Validate field data."""
        validation_errors, validation_warnings = self._collect_studio_validation_issues(data)

        self._apply_studio_issues(
            validation,
            validation_errors,
            validation_warnings,
        )

        self._clear_cached_studio_warnings()

    def _get_character_data(self, character_index):  # pylint: disable=missing-function-docstring
        # Hardcoded at 2 characters but extensible.
        characters = [
            {
                "name": self.character_1_name,
                "role": self.character_1_role,
                "avatar": self.character_1_avatar,
                "pane": "workspace",
            },
            {
                "name": self.character_2_name,
                "role": self.character_2_role,
                "avatar": self.character_2_avatar,
                "pane": "coach",
            },
        ]
        return characters[character_index]

    def _build_session_from_older_state(self):
        """Build a session snapshot from older learner-state fields."""
        return CoachingSession(
            workspace_history=self.workspace_history,
            coach_history=self.coach_history,
            evaluation_fragments=self.evaluation_fragments,
            attempts_used=self.attempts_used,
            finished=self.finished,
            final_submission=self.final_submission,
            final_evaluation_markdown=self.final_evaluation_markdown,
        ).model_dump()

    def _clear_older_state_runtime_fields(self):
        """Reset older learner-state fields after migration."""
        self.workspace_history = []
        self.coach_history = []
        self.evaluation_fragments = []
        self.attempts_used = 0
        self.finished = False
        self.final_submission = ""
        self.final_evaluation_markdown = ""

    def _ensure_sessions_initialized(self):
        """Ensure Coaching learner state has a normalized active session."""
        raw = self.sessions if isinstance(self.sessions, list) else []
        normalized_dicts = []
        for item in raw:
            try:
                normalized_dicts.append(CoachingSession.model_validate(item).model_dump())
            except pydantic.ValidationError:
                continue
        sessions_changed = normalized_dicts != raw

        migrate_from_older_state = not normalized_dicts
        if migrate_from_older_state:
            normalized_dicts = [self._build_session_from_older_state()]
            sessions_changed = True

        if sessions_changed:
            self.sessions = normalized_dicts

        if migrate_from_older_state:
            self._clear_older_state_runtime_fields()
            self.save()

    def _get_active_session(self):
        """Return the active learner session."""
        self._ensure_sessions_initialized()
        return list(self.sessions)[-1]

    def _set_active_session(self, session):
        """Replace the active learner session, validating at write time."""
        validated = CoachingSession(**(session or {})).model_dump()
        sessions = list(self.sessions or [])
        if sessions:
            sessions[-1] = validated
        else:
            sessions = [validated]
        self.sessions = sessions
        return validated

    def _start_new_session(self):
        """Append and return a fresh active learner session."""
        sessions = list(self.sessions or [])
        sessions.append(_EMPTY_SESSION.copy())
        self.sessions = sessions
        return sessions[-1]

    def _session_has_meaningful_data(self, session):
        """Return whether a session contains learner progress worth preserving."""
        return session != _EMPTY_SESSION

    def _ensure_histories(self):
        """
        Initialize chat histories.
        """
        return self._get_active_session()

    def _record_fragment(self, character_index, user_message, character_message, session=None, **extra):
        """
        Persist a conversation fragment into the appropriate history list.
        """
        session = session or self._ensure_histories()
        fragment = {
            "character_index": character_index,
            "user_message": user_message,
            "character_message": character_message,
            "time": now().isoformat(),
        }
        fragment.update(extra)
        if fragment.get("is_evaluation"):
            evaluations = list(session["evaluation_fragments"])
            evaluations.append(fragment)
            session["evaluation_fragments"] = evaluations
            return self._set_active_session(session)
        if character_index == 1:
            coach = list(session["coach_history"])
            coach.append(fragment)
            session["coach_history"] = coach
        else:
            workspace = list(session["workspace_history"])
            workspace.append(fragment)
            session["workspace_history"] = workspace
        return self._set_active_session(session)

    def _is_evaluation_fragment(self, fragment):  # pylint: disable=missing-function-docstring
        if fragment.get("is_evaluation"):
            return True
        if fragment.get("character_index") != 0:
            return False
        if fragment.get("user_message"):
            return False
        evaluation = self._get_active_session()["final_evaluation_markdown"]
        if not evaluation:
            return False
        return fragment.get("character_message") == evaluation

    def _get_chat_fragment_messages(self, fragment):  # pylint: disable=missing-function-docstring
        if self._is_evaluation_fragment(fragment):
            return []
        character_index = fragment["character_index"]
        pane = self._get_character_data(character_index)["pane"]
        messages = []
        user_content = fragment.get("user_message")
        if user_content:
            messages.append({
                "character": {
                    "name": "",
                    "role": "user",
                    "avatar": "",
                    "pane": pane,
                },
                "is_user": True,
                "content": user_content,
                "pane": pane,
            })
        messages.append({
            "character": self._get_character_data(character_index),
            "is_user": False,
            "content": fragment["character_message"],
            "pane": pane,
        })
        return messages

    def _get_chat_histories(self):
        """
        Get chat histories separated by character.
        """
        session = self._ensure_histories()
        chat_histories = [[], []]
        for fragment in session["workspace_history"]:
            chat_histories[0].extend(self._get_chat_fragment_messages(fragment))
        for fragment in session["coach_history"]:
            chat_histories[1].extend(self._get_chat_fragment_messages(fragment))
        return chat_histories

    def _render_final_report(self, final_submission):
        return self.loader.render_django_template(
            "/templates/final_evaluation.html",
            {
                "self": self,
                "final_submission": final_submission,
                "evaluator": self._get_character_data(0),
            },
        )

    def _build_final_report_payload(self):  # pylint: disable=missing-function-docstring
        session = self._get_active_session()
        if not session["finished"]:
            return None
        final_submission = session["final_submission"]
        evaluation_markdown = session["final_evaluation_markdown"]
        if not final_submission or not evaluation_markdown:
            return None
        report_html = self._render_final_report(final_submission)
        return {
            "final_submission": final_submission,
            "evaluation_markdown": evaluation_markdown,
            "report_html": report_html,
            "show_report_card": True,
            "attempts": self._get_attempt_state(),
            "finished": session["finished"],
        }

    def _messages_for_character(self, character_index, user_input=None):
        """
        Build LLM message payload for the requested character.
        """
        session = self._ensure_histories()
        history_fragments = (
            session["workspace_history"] if character_index == 0 else session["coach_history"]
        )
        chat_history = []
        if character_index == 0 and self.initial_message:
            chat_history.append({
                "character": self._get_character_data(0),
                "content": self.initial_message,
            })
        if character_index == 1 and self.coach_initial_message:
            chat_history.append({
                "character": self._get_character_data(1),
                "content": self.coach_initial_message,
            })
        for fragment in history_fragments:
            chat_history.extend(self._get_chat_fragment_messages(fragment))
        if user_input is not None:
            chat_history.append({
                "character": {"name": "", "role": "user"},
                "content": user_input,
            })

        prompt = self._render_template(
            [
                self.character_1_prompt,
                self.character_2_prompt,
            ][character_index],
            scenario_data=self.scenario_data,
            character_data=self._get_character_data(character_index),
        )
        blacklist_instruction = self._build_blacklist_instruction()
        if blacklist_instruction:
            prompt += "\n\n" + blacklist_instruction
        prompt += "\n\n" + self._render_template(
            self.conversation_format,
            messages=chat_history,
        )

        def _generate():
            yield {"role": "system", "content": prompt}
            if self._model_slot() == SupportedModels.CLAUDE_SONNET.name:
                # Claude needs a dummy user reply before the first assistant reply.
                yield {"role": "user", "content": "."}

        return _generate()

    def _get_attempt_state(self):
        """
        Return attempt usage details for the frontend.
        """
        session = self._get_active_session()
        max_attempts = self.max_attempts or 0
        attempts_used = session["attempts_used"]
        max_attempts = max(max_attempts, 0)
        attempts_used = max(attempts_used, 0)
        attempts_remaining = max_attempts - attempts_used if max_attempts else None
        if attempts_remaining is not None:
            attempts_remaining = max(attempts_remaining, 0)
        can_retry = True if not max_attempts else (attempts_used < max_attempts)
        return {
            "max_attempts": max_attempts,
            "attempts_used": attempts_used,
            "attempts_remaining": attempts_remaining,
            "can_retry": can_retry,
        }

    def _get_thread_tag(self, context="workspace"):
        """
        Build provider:model:prompt_hash tag for LLM thread continuity.
        """
        llm_service = get_llm_service()
        provider_tag = "custom" if isinstance(llm_service, CustomLLMService) else "default"

        prompt_hasher = hashlib.sha256()

        def _update_hash(value):
            if value:
                prompt_hasher.update(str(value).strip().encode("utf-8"))

        _update_hash(self.initial_message)
        _update_hash(self.character_1_prompt)
        _update_hash(self.character_2_prompt)
        _update_hash(self.evaluator_prompt)
        _update_hash(json.dumps(self._get_blacklist_terms(), ensure_ascii=True))

        prompt_hash = prompt_hasher.hexdigest()
        context = context or "workspace"
        return f"{provider_tag}:{self.model or ''}:{prompt_hash}:{context}"

    def _clear_thread_contexts(self, contexts):
        """
        Remove cached thread ids for the provided context names.
        """
        if not self.thread_map:
            return
        suffixes = tuple(f":{ctx}" for ctx in contexts if ctx)
        if not suffixes:
            return
        self.thread_map = {
            key: value
            for key, value in self.thread_map.items()
            if not key.endswith(suffixes)
        }

    def student_view(self, context=None):
        """
        The primary view of this block, shown to students
        when viewing courses.
        """
        return self._render_preview(is_studio=False)

    def author_view(self, context=None):
        """
        The preview shown in studio.
        """
        return self._render_preview(is_studio=True)

    def _render_preview(self, is_studio: bool):
        """
        Shared preview rendering between student and author views.
        """
        active_session = self._get_active_session()
        characters = list(map(self._get_character_data, range(2)))
        frag = Fragment('<div data-ai-eval-react-root="true"></div>')

        # When rendering the student preview in studio, load studio-specific style fixes.
        if is_studio:
            frag.add_css(resource_loader.load_unicode("static/css/studio_fixes.css"))

        frag.add_javascript_url(self.runtime.local_resource_url(self, "static/bundles/coaching.js"))
        js_data = self._build_view_payload(
            view="student",
            handler_urls={
                "get_character_response": self.runtime.handler_url(self, "get_character_response"),
                "get_evaluator_response": self.runtime.handler_url(self, "get_evaluator_response"),
                "reset_all": self.runtime.handler_url(self, "reset_all"),
                "download_pdf": self.runtime.handler_url(self, "download_pdf"),
            },
            initial_state={
                "chat_histories": self._get_chat_histories(),
                "finished": active_session["finished"],
                "attempts": self._get_attempt_state(),
            },
            meta={
                "characters": characters,
                "initial_message": {
                    "character": self._get_character_data(0),
                    "content": self.initial_message,
                    "pane": "workspace",
                    "is_user": False,
                },
                "coach_initial_message": {
                    "character": self._get_character_data(1),
                    "content": self.coach_initial_message,
                    "pane": "coach",
                    "is_user": False,
                },
                "titles": {
                    "workspace": self.workspace_title,
                    "coach": self.coach_title,
                },
                "allow_reset": self.allow_reset,
                "intro_text": self.intro_text,
                "pdf_download_allowed": self.pdf_download_allowed,
                "pdf_download_title": self.pdf_download_title,
                "pdf_download_description": self.pdf_download_description,
            },
            style_urls=[
                "static/bundles/shared.css",
                "static/css/chatbox.css",
            ]
        )
        final_report = self._build_final_report_payload()
        if final_report:
            js_data["initial_state"]["final_report"] = final_report
        frag.initialize_js("CoachAIEvalXBlock", js_data)
        return frag

    def _studio_parse_json_field(self, field_name, raw_value):
        """Parse Studio JSON textarea values for Coaching-specific fields."""
        if field_name not in {"scenario_data", "blacklist"}:
            return raw_value, None

        if not isinstance(raw_value, str):
            return raw_value, None

        try:
            parsed_value = json.loads(raw_value)
        except json.JSONDecodeError:
            label = self._get_field_display_name(field_name)
            return None, _("{label} must be valid JSON.").format(label=label)

        if field_name == "scenario_data" and not isinstance(parsed_value, dict):
            return None, _("Scenario data must be a JSON object (dictionary).")

        if field_name == "blacklist" and not isinstance(parsed_value, list):
            return None, _("Output blacklist must be a JSON array.")

        if field_name == "blacklist":
            parsed_value = self._sanitize_blacklist_values(parsed_value)

        return parsed_value, None

    @XBlock.json_handler
    def studio_submit(self, data, suffix=""):  # pylint: disable=unused-argument
        """
        Save the Studio editor payload using the existing field validation rules.
        """
        values = {}
        missing_fields = []
        validation_errors = {}

        for field_name in self.editable_fields:
            if field_name not in data:
                missing_fields.append(field_name)
                continue

            parsed_value, parse_error = self._studio_parse_json_field(
                field_name,
                data[field_name],
            )
            if parse_error:
                validation_errors[field_name] = [parse_error]
                continue

            field = self.fields[field_name]
            values[field_name] = field.from_json(parsed_value)

        if missing_fields:
            validation_errors.update({
                field_name: [_("Missing field in Studio payload.")]
                for field_name in missing_fields
            })

        if validation_errors:
            return self._studio_submit_response(
                success=False,
                validation_errors=validation_errors,
                validation_warnings=[],
                meta=self._studio_payload_meta(),
            )

        self.clean_studio_edits(values)

        preview_data = FutureFields(
            new_fields_dict=values,
            newly_removed_fields=[],
            fallback_obj=self,
        )
        validation_errors, validation_warnings = self._collect_studio_validation_issues(
            preview_data,
        )
        self._clear_cached_studio_warnings()
        has_validation_errors = bool(validation_errors)

        if not has_validation_errors:
            for field_name, value in values.items():
                setattr(self, field_name, value)

        return self._studio_submit_response(
            success=not has_validation_errors,
            validation_errors=validation_errors,
            validation_warnings=validation_warnings,
            meta=self._studio_payload_meta(),
        )

    @XBlock.json_handler
    def get_character_response(self, data, suffix=""):
        """
        Generate the next message in the interaction.
        """
        session = self._get_active_session()
        if session["finished"]:
            raise JsonHandlerError(403, "The session has ended.")

        if not isinstance(data, dict):
            raise JsonHandlerError(400, "Invalid payload.")
        if data.get("force_finish"):
            return self.get_evaluator_response({}, suffix)

        try:
            character_index = int(data["character_index"])
        except (KeyError, TypeError, ValueError):
            raise JsonHandlerError(400, "Missing character index.") from None
        if character_index not in (0, 1):
            raise JsonHandlerError(400, "Invalid character index.")

        try:
            user_input = data["user_input"]
        except KeyError as exc:
            raise JsonHandlerError(400, "Missing user input.") from exc
        if user_input is None:
            user_input = ""
        user_input = str(user_input)
        trimmed_input = user_input.strip()

        if character_index == 0:
            max_attempts = self.max_attempts or 0
            if not trimmed_input:
                raise JsonHandlerError(400, "Input cannot be empty.")
            if max_attempts and session["attempts_used"] >= max_attempts:
                raise JsonHandlerError(403, "No attempts remaining.")
            session["attempts_used"] += 1

        thread_context = f"character{character_index}"
        message = self.get_llm_response(
            self._messages_for_character(character_index, user_input),
            tag=self._get_thread_tag(thread_context),
        )
        blacklist_terms = self._get_blacklist_terms()
        if blacklist_terms:
            if re.search(fr"\b({'|'.join(map(re.escape, blacklist_terms))})\b",
                         message, re.I):
                raise JsonHandlerError(500, "Internal error.")
        if self.message_content_tag:
            m = re.search((fr'<{re.escape(self.message_content_tag)}>(.*)'
                           fr'</{re.escape(self.message_content_tag)}>'),
                          message)
            if m:
                message = m.group(1)

        session = self._record_fragment(
            character_index,
            user_input,
            message,
            session=session,
        )
        character = self._get_character_data(character_index)
        return {
            "message": {
                "character": character,
                "content": message,
                "pane": character["pane"],
            },
            "attempts": self._get_attempt_state(),
            "finished": session["finished"],
        }

    @XBlock.json_handler
    def reset_all(self, data, suffix=""):
        """
        Reset both workspace and coach conversations and attempt state.

        Preserve prior meaningful sessions and start a fresh active session.
        """
        session = self._get_active_session()
        if self._session_has_meaningful_data(session):
            self._start_new_session()
        else:
            self._set_active_session(_EMPTY_SESSION.copy())
        self._clear_thread_contexts(["character0", "character1", "evaluator"])
        return {
            "chat_histories": self._get_chat_histories(),
            "attempts": self._get_attempt_state(),
            "finished": self._get_active_session()["finished"],
        }

    @XBlock.json_handler
    def get_evaluator_response(self, data, suffix=""):
        """

        Get the response from the AI model acting to evaluate the learner's
        activity.

        """
        session = self._get_active_session()
        if session["finished"]:
            raise JsonHandlerError(403, "The session has ended.")

        latest_fragment = None
        for fragment in reversed(session["workspace_history"]):
            if (fragment.get("user_message") or "").strip():
                latest_fragment = fragment
                break
        if not latest_fragment:
            raise JsonHandlerError(400, "No learner response available for evaluation.")

        scenario_data = dict(self.scenario_data or {})

        prompt = self._render_template(
            self.evaluator_prompt,
            scenario_data=scenario_data,
        )
        blacklist_instruction = self._build_blacklist_instruction()
        if blacklist_instruction:
            prompt += "\n\n" + blacklist_instruction
        conversation_messages = [
            {
                "character": {"name": "", "role": "user"},
                "content": latest_fragment["user_message"],
            }
        ]
        prompt += "\n\n" + self._render_template(
            self.conversation_format,
            messages=conversation_messages,
        )

        def _evaluator_messages():
            yield {"role": "system", "content": prompt}
            if self._model_slot() == SupportedModels.CLAUDE_SONNET.name:
                yield {"role": "user", "content": "."}

        message = self.get_llm_response(
            _evaluator_messages(),
            tag=self._get_thread_tag("evaluator"),
        )
        session = self._record_fragment(0, "", message, session=session, is_evaluation=True)
        session["finished"] = True
        session["final_submission"] = latest_fragment["user_message"]
        session["final_evaluation_markdown"] = message
        self._set_active_session(session)
        character = {"name": "", "role": "evaluator", "avatar": "", "pane": "workspace"}
        report_html = self._render_final_report(session["final_submission"])
        return {
            "message": {
                "character": character,
                "content": message,
                "pane": character["pane"],
            },
            "final_submission": session["final_submission"],
            "report_html": report_html,
            "evaluation_markdown": message,
            "show_report_card": True,
            "attempts": self._get_attempt_state(),
            "finished": session["finished"],
        }

    @XBlock.handler
    def download_pdf(self, data, suffix=""):
        """
        Generate and download the pdf summary of the exercise.
        """
        if not self.pdf_download_allowed:
            return Response(
                json.dumps({"error": "PDF download is disabled."}),
                status_code=400,
                content_type="application/json",
                charset="utf-8",
            )

        if not self.sessions:
            return Response(
                json.dumps({"error": "No data to build PDF."}),
                status_code=400,
                content_type="application/json",
                charset="utf-8",
            )

        session = self.sessions[-1]

        if not session["finished"]:
            return Response(
                json.dumps(
                    {
                        "error": "PDF can only be generated when the answer has been submitted."
                    }
                ),
                status_code=400,
                content_type="application/json",
                charset="utf-8",
            )

        user = self.runtime.service(self, "user").get_current_user()
        # Fallbacks because these user attributes are not guaranteed to be set.
        user_name = (
            user.full_name
            or user.opt_attrs.get("edx-platform.username")
            or (user.emails and user.emails[-1])
            or "Student"
        )

        # Here we have timestamps, so interleave the individual chats, sorted by message timestamp.
        # A `session` looks like:
        #    [{'character_message': str, 'user_message': str, 'character_index': 0, 'time': 'isotimestring'}]
        # The 'time' key was added in 2026-04, so add a fallback time for old sessions for sorting purposes.
        coach_history = [
            {**entry, "time": entry.get("time", FALLBACK_COACH_MESSAGE_TIME)}
            for entry in session["coach_history"]
        ]
        workspace_history = [
            {**entry, "time": entry.get("time", FALLBACK_WORKSPACE_MESSAGE_TIME)}
            for entry in session["workspace_history"]
        ]

        entries = sorted(coach_history + workspace_history, key=lambda x: x["time"])
        sections = []
        used_coach_initial_message = False
        used_workspace_initial_message = False
        for entry in entries:
            character_info = self._get_character_data(entry["character_index"])
            kind = character_info["pane"]
            if not sections or sections[-1].kind != kind:
                sections.append(CoachedSection(kind=kind, messages=[]))
                if (
                    kind == "coach"
                    and self.coach_initial_message
                    and not used_coach_initial_message
                ):
                    sections[-1].messages.append(
                        CoachedMessage(
                            kind="coach",
                            avatar_url=character_info["avatar"],
                            name=character_info["name"],
                            time=None,
                            content=self.coach_initial_message,
                        )
                    )
                    used_coach_initial_message = True
                if (
                    kind == "workspace"
                    and self.initial_message
                    and not used_workspace_initial_message
                ):
                    sections[-1].messages.append(
                        CoachedMessage(
                            kind="workspace",
                            avatar_url=character_info["avatar"],
                            name=character_info["name"],
                            time=None,
                            content=self.initial_message,
                        )
                    )
                    used_workspace_initial_message = True
            sections[-1].messages.append(
                CoachedMessage(
                    kind="student",
                    avatar_url="",
                    name=user_name,
                    # don't send the time if it's one of the fallback times
                    time=(
                        entry["time"]
                        if entry["time"]
                        not in (
                            FALLBACK_WORKSPACE_MESSAGE_TIME,
                            FALLBACK_COACH_MESSAGE_TIME,
                        )
                        else None
                    ),
                    content=entry["user_message"],
                )
            )
            sections[-1].messages.append(
                CoachedMessage(
                    kind=kind,
                    avatar_url=character_info["avatar"],
                    name=character_info["name"],
                    time=(
                        entry["time"]
                        if entry["time"]
                        not in (
                            FALLBACK_WORKSPACE_MESSAGE_TIME,
                            FALLBACK_COACH_MESSAGE_TIME,
                        )
                        else None
                    ),
                    content=entry["character_message"],
                )
            )

        content = CoachedData(
            final_submission=session["final_submission"],
            final_evaluation=session["final_evaluation_markdown"],
            evaluator_name=self.character_1_name,
            sections=sections,
        )
        return self.build_pdf_response(content)
