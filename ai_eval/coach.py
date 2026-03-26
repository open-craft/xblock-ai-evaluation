"""Multi-agent AI XBlock."""

import hashlib
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
from xblock.validation import ValidationMessage
from web_fragments.fragment import Fragment

from .base import AIEvalXBlock
from .llm import get_llm_service
from .llm_services import CustomLLMService
from .supported_models import SupportedModels


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
    case_details: pydantic.StrictStr
    learning_objectives: typing.List[pydantic.StrictStr]
    evaluation_criteria: typing.List[EvaluationCriterion]


class CoachAIEvalXBlock(AIEvalXBlock):
    """

    AI-powered XBlock for simulated conversations with
    two simulated characters.

    """

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
        help=_(
            "Prompt used to instructs the model how to evaluate learners. "
            "You can use Jinja variables (e.g. scenario_data.evaluation_criteria). "
            "Learn more: https://jinja.palletsprojects.com/en/stable/templates/"
        ),
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
        help=_("Optional introductory paragraph shown above the chat panes. HTML is allowed here."),
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

    def studio_view(self, context):
        """Render Studio edit view with styling only (no extra wrapper)."""
        fragment = super().studio_view(context)
        try:
            fragment.add_css(self.resource_string("static/css/coach_studio.css"))
        except Exception:  # pylint: disable=broad-exception-caught
            pass
        return fragment

    def _render_template(self, template, **context):
        return self._jinja_env.from_string(template).render(context)

    def _get_field_display_name(self, field_name):
        return self.fields[field_name].display_name

    def validate_field_data(self, validation, data):
        """Validate field data."""
        super().validate_field_data(validation, data)

        scenario_data = data.scenario_data
        if not isinstance(scenario_data, dict):
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    (
                        f"{self._get_field_display_name('scenario_data')}: "
                        "must be a JSON object (dictionary)."
                    ),
                )
            )
            scenario_data = {}

        try:
            CoachScenarioData(**scenario_data)
        except pydantic.ValidationError as e:  # pylint: disable=unused-variable
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    (
                        f"{self._get_field_display_name('scenario_data')}: "
                        "structure is invalid. Expected keys: "
                        "case_details (str), learning_objectives (list[str]), "
                        "evaluation_criteria (list[{name: str}])."
                    ),
                )
            )

        # Validate templates early (StrictUndefined): catches missing keys/typos.
        try:
            self._render_template(
                data.conversation_format,
                messages=[{"character": {"name": "", "role": ""}, "content": ""}],
            )
        except jinja2.TemplateError as e:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    f"{self._get_field_display_name('conversation_format')}: {e}",
                )
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
                    scenario_data=scenario_data,
                )
            except jinja2.TemplateError as e:
                validation.add(
                    ValidationMessage(
                        ValidationMessage.ERROR,
                        f"{self._get_field_display_name(prompt_field)}: {e}",
                    )
                )

        try:
            self._render_template(data.evaluator_prompt, scenario_data=scenario_data)
        except jinja2.TemplateError as e:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    f"{self._get_field_display_name('evaluator_prompt')}: {e}",
                )
            )

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

    @staticmethod
    def _empty_session():
        """Return a blank Coaching session payload."""
        return {
            "workspace_history": [],
            "coach_history": [],
            "evaluation_fragments": [],
            "attempts_used": 0,
            "finished": False,
            "final_submission": "",
            "final_evaluation_markdown": "",
        }

    def _normalize_session(self, session):
        """Normalize persisted learner session data into the expected shape."""
        session = dict(session or {})
        normalized = self._empty_session()

        for field_name in ("workspace_history", "coach_history", "evaluation_fragments"):
            value = session.get(field_name)
            normalized[field_name] = list(value) if isinstance(value, list) else []

        attempts_used = session.get("attempts_used", 0)
        try:
            attempts_used = int(attempts_used or 0)
        except (TypeError, ValueError):
            attempts_used = 0
        normalized["attempts_used"] = max(attempts_used, 0)
        normalized["finished"] = bool(session.get("finished", False))
        normalized["final_submission"] = str(session.get("final_submission") or "")
        normalized["final_evaluation_markdown"] = str(
            session.get("final_evaluation_markdown") or ""
        )
        return normalized

    def _build_session_from_older_state(self):
        """Build a session snapshot from older learner-state fields."""
        return self._normalize_session({
            "workspace_history": self.workspace_history,
            "coach_history": self.coach_history,
            "evaluation_fragments": self.evaluation_fragments,
            "attempts_used": self.attempts_used,
            "finished": self.finished,
            "final_submission": self.final_submission,
            "final_evaluation_markdown": self.final_evaluation_markdown,
        })

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
        current_sessions = self.sessions if isinstance(self.sessions, list) else []
        normalized_sessions = []
        sessions_changed = not isinstance(self.sessions, list)

        for session in current_sessions:
            normalized_session = self._normalize_session(session)
            normalized_sessions.append(normalized_session)
            if normalized_session != session:
                sessions_changed = True

        migrate_from_older_state = not normalized_sessions
        if migrate_from_older_state:
            normalized_sessions = [self._build_session_from_older_state()]
            sessions_changed = True

        if sessions_changed:
            self.sessions = normalized_sessions

        if migrate_from_older_state:
            self._clear_older_state_runtime_fields()
            self.save()

    def _get_active_session(self):
        """Return the normalized active learner session."""
        self._ensure_sessions_initialized()
        sessions = list(self.sessions or [])
        active_session = self._normalize_session(sessions[-1])
        if active_session != sessions[-1]:
            self._set_active_session(active_session)
        return active_session

    def _set_active_session(self, session):
        """Replace the active learner session for reliable persistence."""
        normalized_session = self._normalize_session(session)
        sessions = list(self.sessions or [])
        if sessions:
            sessions[-1] = normalized_session
        else:
            sessions = [normalized_session]
        self.sessions = sessions
        return normalized_session

    def _start_new_session(self):
        """Append and return a fresh active learner session."""
        sessions = list(self.sessions or [])
        sessions.append(self._empty_session())
        self.sessions = sessions
        return sessions[-1]

    def _session_has_meaningful_data(self, session):
        """Return whether a session contains learner progress worth preserving."""
        session = self._normalize_session(session)
        return any([
            bool(session["workspace_history"]),
            bool(session["coach_history"]),
            bool(session["evaluation_fragments"]),
            bool(session["final_submission"]),
            bool(session["final_evaluation_markdown"]),
            session["attempts_used"] > 0,
        ])

    def _ensure_histories(self):
        """
        Initialize chat histories.
        """
        return self._get_active_session()

    def _record_fragment(self, character_index, user_message, character_message, session=None, **extra):
        """
        Persist a conversation fragment into the appropriate history list.
        """
        session = self._normalize_session(session or self._ensure_histories())
        fragment = {
            "character_index": character_index,
            "user_message": user_message,
            "character_message": character_message,
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
        prompt += "\n\n" + self._render_template(
            self.conversation_format,
            messages=chat_history,
        )

        def _generate():
            yield {"role": "system", "content": prompt}
            if self.model == SupportedModels.CLAUDE_SONNET.value:
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
        The primary view of the CoachAIEvalXBlock, shown to students
        when viewing courses.
        """
        active_session = self._get_active_session()

        characters = list(map(self._get_character_data, range(2)))

        frag = Fragment()
        frag.add_content(
            self.loader.render_django_template(
                "/templates/coach_layout.html",
                {
                    "self": self,
                    "intro_text": self.intro_text,
                    "characters": characters,
                },
            )
        )
        frag.add_css(self.resource_string("static/css/chatbox.css"))
        frag.add_javascript(self.resource_string("static/js/src/utils.js"))
        marked_html = self.resource_string("static/html/marked-iframe.html")
        js_data = {
            "chat_histories": self._get_chat_histories(),
            "initial_message": {
                "character": self._get_character_data(0),
                "content": self.initial_message,
            },
            "coach_initial_message": {
                "character": self._get_character_data(1),
                "content": getattr(self, 'coach_initial_message', ""),
            },
            "characters": characters,
            "finished": active_session["finished"],
            "attempts": self._get_attempt_state(),
            "max_attempts": self.max_attempts,
            "titles": {
                "workspace": self.workspace_title,
                "coach": self.coach_title,
            },
            "marked_html": marked_html,
        }
        final_report = self._build_final_report_payload()
        if final_report:
            js_data["final_report"] = final_report
        frag.add_javascript(self.resource_string("static/js/src/coach.js"))
        frag.initialize_js("CoachAIEvalXBlock", js_data)
        return frag

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
        if self.blacklist:
            if re.search(fr"\b({'|'.join(map(re.escape, self.blacklist))})\b",
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
            self._set_active_session(self._empty_session())
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
            if self.model == SupportedModels.CLAUDE_SONNET.value:
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
