"""Multi-agent AI XBlock."""

import hashlib
import re
import textwrap

import jinja2
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
    In the given conversation, you are speaking to USER, who is described as: USER_DATA.

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


class CoachAIEvalXBlock(AIEvalXBlock):
    """

    AI-powered XBlock for simulated conversations with
    two simulated characters.

    """

    _jinja_env = SandboxedEnvironment(undefined=jinja2.StrictUndefined)

    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Coached AI Evaluation",
        scope=Scope.settings,
    )

    evaluator_prompt = String(
        display_name=_("Evaluator prompt"),
        help=_(
            "Prompt used to instruct the model how to evaluate the learner"
        ),
        multiline_editor=True,
        default=DEFAULT_EVALUATOR_PROMPT,
        scope=Scope.settings,
    )

    scenario_title = String(
        display_name=_("Scenario title"),
        default="",
        scope=Scope.settings,
    )

    initial_message = String(
        display_name=_("Initial message"),
        default="",
        scope=Scope.settings,
    )

    scenario_data = Dict(
        display_name=_("Scenario data"),
        help=_("Arbitrary data accessible in prompt templates"),
        default={
            "case_details": "",
            "learning_objectives": [],
            "evaluation_criteria": [],
        },
        scope=Scope.settings,
    )

    workspace_title = String(
        display_name=_("Workspace title"),
        default=_("Add your answer"),
        scope=Scope.settings,
    )

    coach_title = String(
        display_name=_("Coach title"),
        default=_("Tutor"),
        scope=Scope.settings,
    )

    intro_text = String(
        display_name=_("Introductory text"),
        help=_("Optional introductory paragraph shown above the chat panes."),
        default="",
        scope=Scope.settings,
        multiline_editor=True,
    )

    character_1_avatar = String(
        display_name=_("Character #1 avatar URL"),
        help=_("URL for character #1 avatar image"),
        scope=Scope.settings,
        default="",
    )

    character_2_avatar = String(
        display_name=_("Character #2 avatar URL"),
        help=_("URL for character #2 avatar image"),
        scope=Scope.settings,
        default="",
    )

    character_1_name = String(
        display_name=_("Character #1 name"),
        help=_("Name of character #1"),
        scope=Scope.settings,
        default="",
    )

    character_1_role = String(
        display_name=_("Character #1 role"),
        help=_("Role of character #1"),
        scope=Scope.settings,
        default="Main character",
    )

    character_1_prompt = String(
        display_name=_("Character #1 prompt"),
        help=_("Prompt to instruct the AI model to act as character #1"),
        scope=Scope.settings,
        default=SAMPLE_CHARACTER_PROMPT,
    )

    character_2_name = String(
        display_name=_("Character #2 name"),
        help=_("Name of character #2"),
        scope=Scope.settings,
        default="",
    )

    character_2_role = String(
        display_name=_("Character #2 role"),
        help=_("Role of character #2"),
        scope=Scope.settings,
        default="Coach",
    )

    character_2_prompt = String(
        display_name=_("Character #2 prompt"),
        help=_("Prompt to instruct the AI model to act as character #2"),
        scope=Scope.settings,
        default=SAMPLE_CHARACTER_PROMPT,
    )

    allow_reset = Boolean(
        display_name=_("Allow reset"),
        help=_("Allow the learner to reset the chat"),
        scope=Scope.settings,
        default=True,
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

    chat_history = List(
        scope=Scope.user_state,
    )

    attempts_used = Integer(
        scope=Scope.user_state,
        default=0,
    )

    input_open = Boolean(
        scope=Scope.user_state,
        default=True,
    )

    max_attempts = Integer(
        display_name=_("Maximum attempts"),
        help=_("Total attempts a learner is allowed for evaluation"),
        default=3,
        scope=Scope.settings,
    )

    editable_fields = AIEvalXBlock.editable_fields + (
        "initial_message",
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
        "allow_reset",
        "blacklist",
        "max_attempts",
    )

    # def studio_view(self, context):
    #     """
    #     Render a form for editing this XBlock
    #     """
    #     fragment = super().studio_view(context)
    #     # fragment.add_javascript(self.resource_string("static/js/src/coach_edit.js"))
    #     # CoachAIEvalXBlock() in coach_edit.js will call
    #     # StudioEditableXBlockMixin().
    #     # fragment.initialize_js("")
    #     return fragment

    def _render_template(self, template, **context):
        return self._jinja_env.from_string(template).render(context)

    def _get_character_data(self, character_index):
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

    def _get_chat_fragment_messages(self, fragment):
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
        """Get chat histories separated by character."""
        chat_histories = [[], []]
        for fragment in self.chat_history:
            character_index = fragment["character_index"]
            chat_history = chat_histories[character_index]
            chat_history.extend(self._get_chat_fragment_messages(fragment))
        return chat_histories

    def _llm_input(self, prompt, user_input=None):
        """Append the chat history to the given system prompt."""
        chat_history = []
        if self.initial_message:
            chat_history.append({
                "character": self._get_character_data(0),
                "content": self.initial_message,
            })
        for fragment in self.chat_history:
            chat_history.extend(self._get_chat_fragment_messages(fragment))
        if user_input is not None:
            chat_history.append({
                "character": {"name": "", "role": "user"},
                "content": user_input,
            })

        prompt += "\n\n" + self._render_template(
            self.conversation_format,
            messages=chat_history,
        )
        yield {"role": "system", "content": prompt}
        if self.model == SupportedModels.CLAUDE_SONNET.value:
            # Claude needs a dummy user reply before the first
            # assistant reply.
            yield {"role": "user", "content": "."}

    def _get_field_display_name(self, field_name):
        return self.fields[field_name].display_name

    def _get_attempt_state(self):
        """Return attempt usage details for the frontend."""
        max_attempts = self.max_attempts or 0
        attempts_used = self.attempts_used or 0
        if max_attempts < 0:
            max_attempts = 0
        if attempts_used < 0:
            attempts_used = 0
        attempts_remaining = max_attempts - attempts_used if max_attempts else None
        if attempts_remaining is not None:
            attempts_remaining = max(attempts_remaining, 0)
        can_retry = True
        if max_attempts:
            can_retry = attempts_used < max_attempts
        input_open = self.input_open
        if input_open is None:
            input_open = True
        return {
            "max_attempts": max_attempts,
            "attempts_used": attempts_used,
            "attempts_remaining": attempts_remaining,
            "can_retry": can_retry and self.allow_reset,
            "input_open": bool(input_open),
        }

    def _get_thread_tag(self):
        """Build provider:model:prompt_hash tag for LLM thread continuity."""
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
        _update_hash(self.scenario_title)

        prompt_hash = prompt_hasher.hexdigest()
        return f"{provider_tag}:{self.model or ''}:{prompt_hash}"

    def student_view(self, context=None):
        """
        The primary view of the MultiAgentAIEvalXBlock, shown to students
        when viewing courses.
        """

        characters = list(map(self._get_character_data, range(2)))

        frag = Fragment()
        frag.add_content(
            self.loader.render_django_template(
                "/templates/coach_layout.html",
                {
                    "self": self,
                    "question_text": f"<h3><b>{self.scenario_title}</b></h3>",
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
            "characters": characters,
            "finished": self.finished,
            "allow_reset": self.allow_reset,
            "attempts": self._get_attempt_state(),
            "max_attempts": self.max_attempts,
            "titles": {
                "workspace": self.workspace_title,
                "coach": self.coach_title,
            },
            "marked_html": marked_html,
        }
        frag.add_javascript(self.resource_string("static/js/src/coach_redesign.js"))
        frag.initialize_js("CoachAIEvalXBlock", js_data)
        return frag

    @XBlock.json_handler
    def get_character_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Generate the next message in the interaction."""
        if self.finished:
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
            input_open = self.input_open
            if input_open is None:
                input_open = True
            if not input_open:
                raise JsonHandlerError(403, "No active attempt.")
            if not trimmed_input:
                raise JsonHandlerError(400, "Input cannot be empty.")
            if max_attempts and self.attempts_used >= max_attempts:
                raise JsonHandlerError(403, "No attempts remaining.")
            self.attempts_used = (self.attempts_used or 0) + 1
            self.input_open = False

        # Hardcoded at 2 characters for now but designed to be extensible.
        template = [
            self.character_1_prompt,
            self.character_2_prompt,
        ][character_index]
        prompt = self._render_template(
            template,
            scenario_data=self.scenario_data,
            character_data=self._get_character_data(character_index),
        )
        message = self.get_llm_response(
            self._llm_input(prompt, user_input),
            tag=self._get_thread_tag(),
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

        self.chat_history.append({
            "character_index": character_index,
            "user_message": user_input,
            "character_message": message,
        })
        character = self._get_character_data(character_index)
        return {
            "message": {
                "character": character,
                "content": message,
                "pane": character["pane"],
            },
            "attempts": self._get_attempt_state(),
            "finished": self.finished,
        }

    @XBlock.json_handler
    def reset(self, data, suffix=""):
        """Reset the chat history."""
        if not self.allow_reset:
            raise JsonHandlerError(403, "Reset is disabled.")
        attempts_state = self._get_attempt_state()
        if self.finished and attempts_state["attempts_remaining"] == 0 and attempts_state["max_attempts"]:
            raise JsonHandlerError(403, "No attempts remaining.")
        self.chat_history = []
        self.finished = False
        self.thread_map = {}
        self.input_open = True
        return {
            "chat_histories": self._get_chat_histories(),
            "attempts": self._get_attempt_state(),
            "finished": self.finished,
        }

    @XBlock.json_handler
    def resume_attempt(self, data, suffix=""):
        """Reopen the session for another attempt without clearing history."""
        max_attempts = self.max_attempts or 0
        if max_attempts and self.attempts_used >= max_attempts:
            raise JsonHandlerError(403, "No attempts remaining.")
        self.finished = False
        self.input_open = True
        return {
            "attempts": self._get_attempt_state(),
            "finished": self.finished,
        }

    @XBlock.json_handler
    def get_evaluator_response(self, data, suffix=""):
        """

        Get the response from the AI model acting to evaluate the learner's
        activity.

        """
        if self.finished:
            raise JsonHandlerError(403, "The session has ended.")
        if self.input_open:
            raise JsonHandlerError(400, "No learner response available for evaluation.")

        latest_fragment = next(
            (
                fragment
                for fragment in reversed(self.chat_history)
                if (fragment.get("user_message") or "").strip()
            ),
            None,
        )
        if not latest_fragment:
            raise JsonHandlerError(400, "No learner response available for evaluation.")

        prompt = self._render_template(
            self.evaluator_prompt,
            scenario_data=self.scenario_data,
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
            tag=self._get_thread_tag(),
        )
        self.chat_history.append({
            "character_index": 0,
            "user_message": "",
            "character_message": message,
        })
        self.finished = True
        character = {"name": "", "role": "evaluator", "avatar": "", "pane": "workspace"}
        return {
            "message": {
                "character": character,
                "content": message,
                "pane": character["pane"],
            },
            "attempts": self._get_attempt_state(),
            "finished": self.finished,
        }
