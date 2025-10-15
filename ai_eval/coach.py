"""AI-powered coached conversation XBlock."""

from __future__ import annotations

import hashlib
import json
import re
import textwrap
from typing import Iterable

import jinja2
from django.utils.translation import gettext_noop as _
from jinja2.sandbox import SandboxedEnvironment
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Boolean, Dict, List, Scope, String
from web_fragments.fragment import Fragment

from .base import AIEvalXBlock
from .llm import get_llm_service
from .llm_services import CustomLLMService
from .supported_models import SupportedModels


SAMPLE_CHARACTER_PROMPT = textwrap.dedent(
    """
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
    """
).strip()  # noqa: E501


DEFAULT_EVALUATOR_PROMPT = textwrap.dedent(
    """
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
    """
).strip()  # noqa: E501


DEFAULT_CONVERSATION_FORMAT = textwrap.dedent(
    """
    <conversation>
        {% for message in messages %}
            <message>
                <agent>{{ message.character.name }}</agent>
                <role>{{ message.character.role }}</role>
                <content>{{ message.content | escape }}</content>
            </message>
        {% endfor %}
    </conversation>
    """
)


class CoachAIEvalXBlock(AIEvalXBlock):
    """
    AI-powered XBlock for simulated conversations with two characters and an evaluator.
    """

    _jinja_env = SandboxedEnvironment(undefined=jinja2.StrictUndefined)

    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Coached AI Evaluation",
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

    character_image = String(
        display_name=_("Character Image URL"),
        help=_(
            "URL for an image to be shown to the left of the chat box; "
            "leave empty to disable"
        ),
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
        multiline_editor=True,
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
        multiline_editor=True,
    )

    evaluator_prompt = String(
        display_name=_("Evaluator prompt"),
        help=_("Prompt used to instruct the model how to evaluate the learner"),
        multiline_editor=True,
        default=DEFAULT_EVALUATOR_PROMPT,
        scope=Scope.settings,
    )

    allow_reset = Boolean(
        display_name=_("Allow reset"),
        help=_("Allow the learner to reset the chat"),
        scope=Scope.settings,
        default=True,
    )

    conversation_format = String(
        display_name=_("Conversation format template"),
        help=_("Template used to format the conversation, appended to all prompts"),
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
        default=["AI assistant"],
    )

    finished = Boolean(scope=Scope.user_state, default=False)
    chat_history = List(scope=Scope.user_state, default=[])

    editable_fields = AIEvalXBlock.editable_fields + (
        "initial_message",
        "scenario_title",
        "scenario_data",
        "character_image",
        "character_1_name",
        "character_1_role",
        "character_1_prompt",
        "character_2_name",
        "character_2_role",
        "character_2_prompt",
        "evaluator_prompt",
        "allow_reset",
        "conversation_format",
        "message_content_tag",
        "blacklist",
    )

    def _render_template(self, template: str, **context) -> str:
        return self._jinja_env.from_string(template).render(context)

    def _get_character_data(self, character_index: int) -> dict:
        characters = [
            {
                "name": self.character_1_name,
                "role": self.character_1_role,
            },
            {
                "name": self.character_2_name,
                "role": self.character_2_role,
            },
        ]
        return characters[character_index]

    def _get_chat_fragment_messages(self, fragment: dict) -> list[dict]:
        character_index = fragment["character_index"]
        return [
            {
                "character": {"name": "", "role": "user"},
                "content": fragment["user_message"],
            },
            {
                "character": self._get_character_data(character_index),
                "content": fragment["character_message"],
            },
        ]

    def _get_chat_histories(self) -> list[list[dict]]:
        """Get chat histories separated by character."""
        chat_histories = [[], []]
        for fragment in self.chat_history:
            chat_histories[fragment["character_index"]].extend(
                self._get_chat_fragment_messages(fragment)
            )
        return chat_histories

    def _llm_input(self, prompt: str, user_input: str | None = None) -> Iterable[dict]:
        """Append the chat history to the given system prompt."""
        chat_history = []
        if self.initial_message:
            chat_history.append(
                {
                    "character": self._get_character_data(0),
                    "content": self.initial_message,
                }
            )
        for fragment in self.chat_history:
            chat_history.extend(self._get_chat_fragment_messages(fragment))
        if user_input is not None:
            chat_history.append(
                {
                    "character": {"name": "", "role": "user"},
                    "content": user_input,
                }
            )

        prompt += "\n\n" + self._render_template(
            self.conversation_format,
            messages=chat_history,
        )
        yield {"role": "system", "content": prompt}
        if self.model == SupportedModels.CLAUDE_SONNET.value:
            # Claude needs a dummy user reply before the first assistant reply.
            yield {"role": "user", "content": "."}

    def _get_prompt_tag(self, prompt_type: str, prompt_text: str) -> str:
        llm_service = get_llm_service()
        provider_tag = "custom" if isinstance(llm_service, CustomLLMService) else "default"
        prompt_hash = hashlib.sha256()
        prompt_hash.update(prompt_type.encode("utf-8"))
        prompt_hash.update((self.model or "").encode("utf-8"))
        prompt_hash.update(prompt_text.encode("utf-8"))
        prompt_hash.update((self.initial_message or "").encode("utf-8"))
        prompt_hash.update(
            json.dumps(self.scenario_data, sort_keys=True, default=str).encode("utf-8")
        )
        return f"{provider_tag}:{self.model}:coach:{prompt_hash.hexdigest()}"

    def student_view(self, context=None):  # pylint: disable=unused-argument
        """
        The primary view of the CoachAIEvalXBlock, shown to students.
        """
        characters = [self._get_character_data(index) for index in range(2)]

        frag = Fragment()
        frag.add_content(
            self.loader.render_django_template(
                "/templates/chatbox_multi.html",
                {
                    "self": self,
                    "has_finish_button": True,
                    "question_text": f"<h3><b>{self.scenario_title}</b></h3>",
                    "characters": characters,
                },
            )
        )
        frag.add_css(self.resource_string("static/css/chatbox.css"))
        frag.add_javascript(self.resource_string("static/js/src/utils.js"))
        frag.add_javascript(self.resource_string("static/js/src/chatbox_multi.js"))
        frag.add_javascript(self.resource_string("static/js/src/coach.js"))
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
            "marked_html": marked_html,
        }
        frag.initialize_js("CoachAIEvalXBlock", js_data)
        return frag

    def _check_blacklist(self, message: str) -> None:
        if self.blacklist:
            pattern = r"\b(" + "|".join(map(re.escape, self.blacklist)) + r")\b"
            if re.search(pattern, message, re.IGNORECASE):
                raise JsonHandlerError(500, "Internal error.")

    def _maybe_extract_tagged_content(self, message: str) -> str:
        if not self.message_content_tag:
            return message
        pattern = rf"<{re.escape(self.message_content_tag)}>(.*)</{re.escape(self.message_content_tag)}>"
        match = re.search(pattern, message, re.IGNORECASE | re.DOTALL)
        return match.group(1) if match else message

    @XBlock.json_handler
    def get_character_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Generate the next message in the interaction."""
        if self.finished:
            raise JsonHandlerError(403, "The session has ended.")

        if data.get("force_finish"):
            return self.get_evaluator_response({}, suffix)

        try:
            user_input = data["user_input"]
            character_index = int(data["character_index"])
        except (KeyError, TypeError, ValueError) as exc:
            raise JsonHandlerError(400, "Invalid input.") from exc

        template = [
            self.character_1_prompt,
            self.character_2_prompt,
        ][character_index]
        prompt = self._render_template(
            template,
            scenario_data=self.scenario_data,
            character_data=self._get_character_data(character_index),
        )
        messages = list(self._llm_input(prompt, user_input))
        response = self.get_llm_response(
            messages,
            tag=self._get_prompt_tag(f"character:{character_index}", prompt),
        )
        self._check_blacklist(response)
        response = self._maybe_extract_tagged_content(response)

        self.chat_history.append(
            {
                "character_index": character_index,
                "user_message": user_input,
                "character_message": response,
            }
        )
        return {
            "message": {
                "character": self._get_character_data(character_index),
                "content": response,
            },
            "finished": self.finished,
        }

    @XBlock.json_handler
    def reset(self, data, suffix=""):  # pylint: disable=unused-argument
        """Reset the chat history."""
        if not self.allow_reset:
            raise JsonHandlerError(403, "Reset is disabled.")
        self.chat_history = []
        self.finished = False
        self.thread_map = {}
        return {}

    @XBlock.json_handler
    def get_evaluator_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """
        Get the response from the AI model acting to evaluate the learner's activity.
        """
        if self.finished:
            raise JsonHandlerError(403, "The session has ended.")

        prompt = self._render_template(
            self.evaluator_prompt,
            scenario_data=self.scenario_data,
        )
        messages = list(self._llm_input(prompt))
        response = self.get_llm_response(
            messages,
            tag=self._get_prompt_tag("evaluator", prompt),
        )
        self.chat_history.append(
            {
                "character_index": 0,
                "user_message": "",
                "character_message": response,
            }
        )
        self.finished = True
        return {
            "message": {
                "character": {"name": "", "role": "evaluator"},
                "content": response,
            },
            "finished": self.finished,
        }
