"""Multi-agent AI XBlock."""

import itertools
import re
import textwrap
import typing

import jinja2
import pydantic
from django.utils.translation import gettext_noop as _
from jinja2.sandbox import SandboxedEnvironment
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Boolean, Dict, List, Scope, String
from xblock.validation import ValidationMessage
from web_fragments.fragment import Fragment

from .base import AIEvalXBlock
from .supported_models import SupportedModels


DEFAULT_SUPERVISOR_PROMPT = textwrap.dedent("""
    You are a supervisor managing an interaction between the following agents: Coach, Character.
    Based on the conversation, decide which agent should respond next.
    You can choose from: Character, Coach, or FINISH.
    You are responsible for managing the flow of the conversation between agents.
    The conversation should flow naturally with the Character until specific conditions are met.
    Switch control to the Coach only under the following conditions:
    (1) The learner makes the same mistake **three times in a row**.
    (2) The learner **explicitly** asks for help.
    (3) The learner gets **significantly off topic** and is no longer addressing the learning objectives or the project.
    If the learner shows minor deviations or uncertainty, let the Character continue interacting with the learner.
    And if the learner specifically asks for help, you should always call on the Coach.
    Your goal is to provide enough opportunities for the learner to self-correct and progress naturally without premature intervention.
    Call the conversation complete and choose FINISH only under the following conditions:
    (1) The **learning objectives and evaluation criteria are fully met**,
    (2) The learner explicitly indicates they are done with the conversation, or
    (3) Progress **stalls** and it becomes evident that the learner cannot achieve the learning objectives after multiple attempts.
    Always finish the conversation when the learner requests.
    If the interaction is complete, choose 'FINISH'.
    Learning Objectives: {{ scenario_data.scenario.learning_objectives }}
    Evaluation Criteria: {{ scenario_data.evaluation_criteria }}

    Who should act next? Do not give an explanation. Output exactly and only one option.
    Choose from: ['Character', 'Coach', 'FINISH']
""").strip()  # noqa


DEFAULT_AGENT_PROMPT = textwrap.dedent("""
    You are {{ character_name }}.
    In the given conversation, you are speaking to {{ user_character_name }}, who is described as: {{ user_character_data }}.

    {% if character_data %}
        Personality details: {{ character_data.professional_summary }}
        Key competencies: {{ character_data.key_competencies }}
        Behavioral profile: {{ character_data.behavioral_profile }}
    {% endif %}

    {% if role == "Coach" %}
        Learning Objectives: {{ scenario_data.scenario.learning_objectives }}
        Evaluation Criteria: {{ scenario_data.evaluation_criteria }}
    {% endif %}

    Case Details: {{ scenario_data.scenario.case_details }}.

    {% for agent in scenario_data.agents %}
        {% if role.lower() == agent.role %}
            {{ agent.instructions }}
        {% endif %}
    {% endfor %}
    Speak in a dialogue fashion, naturally and succinctly.
    Do not do the work for the student. If the student tries to get you to answer the questions you are asking them to supply information on, redirect them to the task.
    Do not present tables, lists, or detailed written explanations. For instance, do not say 'the main goals include: 1. ...'
    Output only the text content of the next message from {{ character_name }}.
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
                <agent>{{ message.agent }}</agent>
                <name>{{ message.name }}</name>
                <role>{{ message.role }}</role>
                <content>{{ message.content | escape }}</content>
            </message>
        {% endfor %}
    </conversation>
""")


class Scenario(pydantic.BaseModel):
    title: str
    initial_message: str


class ScenarioCharacters(pydantic.BaseModel):
    user_character: str


class ScenarioData(pydantic.BaseModel):
    scenario: Scenario
    characters: ScenarioCharacters


class Character(pydantic.BaseModel):
    name: str
    role: str


class CharacterData(pydantic.BaseModel):
    characters: typing.List[Character]


class MultiAgentAIEvalXBlock(AIEvalXBlock):
    """

    AI-powered XBlock for simulated conversations with
    multiple agents and custom scenarios.

    """

    _jinja_env = SandboxedEnvironment(undefined=jinja2.StrictUndefined)

    MAIN_CHARACTER_KEY = "main_character"
    USER_CHARACTER_KEY = "user_character"

    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Multi-agent AI Evaluation",
        scope=Scope.settings,
    )

    supervisor_prompt = String(
        display_name=_("Supervisor prompt"),
        help=_(
            'Prompt used to instruct the model how to choose the next agent. '
            'Instruct it to choose between one of the roles in "Role '
            'characters" or the command specified in "Supervisor finish '
            'command".'
        ),
        multiline_editor=True,
        default=DEFAULT_SUPERVISOR_PROMPT,
        scope=Scope.settings,
    )

    finish_command = String(
        display_name=_("Supervisor finish command"),
        help=_("Output from the Supervisor to be recognised as end of session"),
        scope=Scope.settings,
        default=_("FINISH"),
    )

    supervisor_prefill = String(
        display_name=_("Prefill for supervisor reply"),
        help=_("Prefill used to hint the model when acting as the Supervisor"),
        scope=Scope.settings,
        default=_("Choice: "),
    )

    role_characters = Dict(
        display_name=_("Agent characters"),
        help=_(
            "Mapping of agents used by the Supervisor to character keys "
            "in scenario data"
        ),
        scope=Scope.settings,
        default={
            _("User"): USER_CHARACTER_KEY,
            _("Character"): MAIN_CHARACTER_KEY,
            _("Coach"): "coach",
        },
    )

    agent_prompt = String(
        display_name=_("Agent prompt"),
        help=_(
            "Prompt used to instruct the model how to act as an agent. "
            "Template variables available are: role, scenario_data, "
            "character_data, character_name, user_character_data, "
            "user_character_name"
        ),
        multiline_editor=True,
        default=DEFAULT_AGENT_PROMPT,
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

    scenario_data = Dict(
        scope=Scope.settings,
        default={
            "scenario": {
                "title": "",
                "initial_message": "",
                "case_details": "",
                "learning_objectives": [],
            },
            "evaluation_criteria": [],
            "characters": {
                USER_CHARACTER_KEY: "Alex",
                MAIN_CHARACTER_KEY: "Jack",
                "coach": "Maya",
            },
            "agents": [],
        }
    )

    character_data = Dict(
        scope=Scope.settings,
        default={
            "characters": [],
        }
    )

    allow_reset = Boolean(
        display_name=_("Allow reset"),
        help=_("Allow the learner to reset the chat"),
        scope=Scope.settings,
        default=True,
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
        # assistant if the user tries to do subvert the plot.
        default=["AI assistant"],
    )

    finished = Boolean(
        scope=Scope.user_state,
        default=False,
    )

    # XXX: Deprecated.
    chat_history = List(
        scope=Scope.user_state,
        default=[],
    )

    sessions = List(
        scope=Scope.user_state,
        default=[[]],
    )

    editable_fields = AIEvalXBlock.editable_fields + (
        "scenario_data",
        "character_data",
        "supervisor_prompt",
        "supervisor_prefill",
        "role_characters",
        "finish_command",
        "agent_prompt",
        "evaluator_prompt",
        "allow_reset",
        "blacklist",
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.chat_history:
            self.sessions = [self.chat_history]
            self.chat_history = []
            self.save()

    def studio_view(self, context):
        """
        Render a form for editing this XBlock
        """
        fragment = super().studio_view(context)
        fragment.add_javascript(self.resource_string("static/js/src/multiagent_edit.js"))
        jsoneditor_html = self.resource_string("static/html/jsoneditor-iframe.html")
        js_data = {
            'jsoneditor_html': jsoneditor_html,
        }
        # MultiAgentAIEvalXBlock() in multiagent_edit.js will call
        # StudioEditableXBlockMixin().
        fragment.initialize_js("MultiAgentAIEvalXBlock", js_data)
        return fragment

    def _render_template(self, template, **context):
        return self._jinja_env.from_string(template).render(context)

    def _get_character(self, key):
        """For a given character key, get its agent and character data."""
        for agent, k in self.role_characters.items():
            if k == key:
                name = self.scenario_data["characters"].get(key)
                data = self._get_character_data(name)
                return agent, data
        return "", {}

    def _llm_input(self, prompt, user_input):
        """Append the chat history to the given system prompt."""
        main_agent, main_data = self._get_character(self.MAIN_CHARACTER_KEY)
        user_agent, user_data = self._get_character(self.USER_CHARACTER_KEY)
        initial_messages = []
        if self.scenario_data["scenario"]["initial_message"]:
            initial_messages.append({
                "role": "assistant",
                "content": self.scenario_data["scenario"]["initial_message"],
                "extra": {
                    "role": main_agent,
                    "character_data": main_data,
                },
            })
        user_message = {
            "role": "user",
            "content": user_input,
        }
        chat_history = []
        # For legacy reasons, stored chat history has the format of a chat
        # history with an LLM completion, with each message having a "role"
        # of "user" or "assistant".
        for message in itertools.chain(initial_messages,
                                       self.sessions[-1],
                                       [user_message]):
            if message["role"] == "assistant":
                agent = message["extra"].get("role") or ""
                character_data = message["extra"].get("character_data") or {}
            else:
                agent = user_agent
                character_data = user_data
            chat_history.append({
                "content": message["content"],
                "agent": agent,
                "name": character_data.get("name", ""),
                "role": character_data.get("role", ""),
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

    def validate_field_data(self, validation, data):
        """Validate field data."""
        super().validate_field_data(validation, data)

        try:
            ScenarioData(**data.scenario_data)
        except pydantic.ValidationError as e:
            for error in e.errors():
                field = error["loc"][0]
                msg = error["msg"]
                validation.add(ValidationMessage(
                    ValidationMessage.ERROR,
                    (
                        f"{self._get_field_display_name('scenario_data')}: "
                        f"{field!r}: {msg}"
                    ),
                ))
        try:
            CharacterData(**data.character_data)
        except pydantic.ValidationError as e:
            for error in e.errors():
                field = error["loc"][0]
                msg = error["msg"]
                validation.add(ValidationMessage(
                    ValidationMessage.ERROR,
                    (
                        f"{self._get_field_display_name('character_data')}: "
                        f"{field!r}: {msg}"
                    ),
                ))

        for prompt_field in ['supervisor_prompt', 'evaluator_prompt']:
            try:
                self._render_template(getattr(data, prompt_field),
                                      scenario_data=data.scenario_data)
            except jinja2.TemplateError as e:
                validation.add(ValidationMessage(
                    ValidationMessage.ERROR,
                    f"{self._get_field_display_name(prompt_field)}: {e}",
                ))

        # pylint: disable=too-many-nested-blocks
        try:
            self._render_template(
                data.agent_prompt,
                role="",
                character_name="",
                character_data=None,
                user_character_name="",
                user_character_data="",
                scenario_data=data.scenario_data,
            )
        except jinja2.TemplateError as e:
            validation.add(ValidationMessage(
                ValidationMessage.ERROR,
                f"{self._get_field_display_name('agent_prompt')}: {e}",
            ))
        else:
            chars = data.character_data.get("characters", [])
            for i, char_data in enumerate(chars):
                # Character name is validated above but may be missing yet.
                char_name = char_data.get("name", "")
                role = ""
                for key, name in data.scenario_data.get("characters",
                                                        {}).items():
                    if name == char_name:
                        for r, k in data.role_characters.items():
                            if k == key:
                                role = r
                                break
                        break
                try:
                    self._render_template(
                        data.agent_prompt,
                        role=role,
                        character_name=char_name,
                        character_data=char_data,
                        user_character_name="",
                        user_character_data="",
                        scenario_data=data.scenario_data,
                    )
                except jinja2.TemplateError as e:
                    validation.add(ValidationMessage(
                        ValidationMessage.ERROR,
                        (
                            f"{self._get_field_display_name('agent_prompt')}/"
                            f"{self._get_field_display_name('character_data')}"
                            f"[{i}]: {e}"
                        ),
                    ))

    def student_view(self, context=None):
        """
        The primary view of the MultiAgentAIEvalXBlock, shown to students
        when viewing courses.
        """

        frag = Fragment()
        scenario = self.scenario_data['scenario']
        frag.add_content(
            self.loader.render_django_template(
                "/templates/chatbox.html",
                {
                    "self": self,
                    "has_finish_button": True,
                    "question_text": f"<h3><b>{scenario['title']}</b></h3>",
                },
            )
        )
        frag.add_css(self.resource_string("static/css/chatbox.css"))
        frag.add_javascript(self.resource_string("static/js/src/utils.js"))
        frag.add_javascript(self.resource_string("static/js/src/chatbox.js"))
        frag.add_javascript(self.resource_string("static/js/src/multiagent.js"))
        marked_html = self.resource_string("static/html/marked-iframe.html")
        main_agent = ""
        main_name = ""
        main_data = {}
        for agent, key in self.role_characters.items():
            if key == self.MAIN_CHARACTER_KEY:
                main_agent = agent
                main_name = self._get_character_name(agent)
                main_data = self._get_character_data(main_name)
                break
        js_data = {
            "messages": self.sessions[-1],
            "main_character_agent": main_agent,
            "main_character_data": {
                "name": main_data.get("name", main_name),
                "role": main_data.get("role", ""),
            },
            "initial_message": scenario["initial_message"],
            "finished": self.finished,
            "marked_html": marked_html,
        }
        frag.initialize_js("MultiAgentAIEvalXBlock", js_data)
        return frag

    def _get_next_agent(self, user_input):
        """Use the LLM to decide which agent should respond to the user."""
        prompt = self._render_template(self.supervisor_prompt,
                                       scenario_data=self.scenario_data)
        messages = list(self._llm_input(prompt, user_input))
        if self.model == SupportedModels.CLAUDE_SONNET.value:
            if self.supervisor_prefill:
                messages.append({"role": "assistant",
                                 "content": self.supervisor_prefill})
        response = self.get_llm_response(messages).strip()

        choices = list(itertools.chain(self.role_characters.keys(),
                                       [self.finish_command]))
        m = re.search(fr"\b({'|'.join(map(re.escape, choices))})\b",
                      response, re.I)
        if not m:
            raise RuntimeError(f"bad response {response!r}")
        found = m.group(1)
        for choice in choices:
            if choice.lower() == found.lower():
                return choice

        # Should not be reached.
        raise RuntimeError("unknown error")

    def _get_character_name(self, agent):
        """Get character name from agent name (supervisor choice)."""
        if agent == self.finish_command:
            return None
        key = self.role_characters[agent]
        return self.scenario_data["characters"][key]

    def _get_character_data(self, character_name):
        """Get character data from character name."""
        for character_data in self.character_data["characters"]:
            if character_data["name"] == character_name:
                return character_data
        return {}

    def _get_agent_response(self, agent, user_input):
        """

        Use the LLM to generate a message from the given agent in the scenario.

        """
        user_name = self.scenario_data["characters"][self.USER_CHARACTER_KEY]
        user_data = self._get_character_data(user_name)
        character_name = self._get_character_name(agent)
        character_data = self._get_character_data(character_name)
        prompt = self._render_template(
            self.agent_prompt,
            scenario_data=self.scenario_data,
            role=agent,
            character_data=character_data,
            character_name=character_name,
            user_character_data=user_data,
            user_character_name=user_name,
        )
        messages = list(self._llm_input(prompt, user_input))
        response = self.get_llm_response(messages)
        if self.blacklist:
            if re.search(fr"\b({'|'.join(map(re.escape, self.blacklist))})\b",
                         response, re.I):
                raise JsonHandlerError(500, "Internal error.")
        if self.message_content_tag:
            m = re.search((fr'<{re.escape(self.message_content_tag)}>(.*)'
                           fr'</{re.escape(self.message_content_tag)}>'),
                          response)
            if m:
                response = m.group(1)
        return response

    def _get_evaluator_response(self, user_input):
        """Get the response from the special "Evaluator" agent."""
        prompt = self._render_template(self.evaluator_prompt,
                                       scenario_data=self.scenario_data)
        messages = list(self._llm_input(prompt, user_input))
        response = self.get_llm_response(messages)
        return response

    @XBlock.json_handler
    def get_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Generate the next message in the interaction."""
        # We use the LLM twice here: one time to decide which character to use,
        # and one time to act as that character.

        if self.finished:
            raise JsonHandlerError(403, "The session has ended.")

        if data.get("force_finish", False):
            user_input = ""
            agent = None
            is_evaluator = True
        else:
            user_input = str(data["user_input"])
            agent = self._get_next_agent(user_input)
            is_evaluator = agent == self.finish_command

        if is_evaluator:
            message = self._get_evaluator_response(user_input)
            self.finished = True
            character_data = {}
        else:
            message = self._get_agent_response(agent, user_input)
            character_name = self._get_character_name(agent)
            character_data = self._get_character_data(character_name)
            character_data = character_data.copy()
            character_data.setdefault("name", character_name)

        self.sessions[-1].append({"role": "user", "content": user_input})
        extra = {"is_evaluator": is_evaluator, "role": agent,
                 "character_data": character_data}
        self.sessions[-1].append({"role": "assistant", "content": message,
                                  "extra": extra})
        return {
            "message": message,
            "finished": self.finished,
            "is_evaluator": is_evaluator,
            "role": agent,
            "character_data": {
                "name": character_data.get("name", ""),
                "role": character_data.get("role", ""),
            },
        }

    @XBlock.json_handler
    def reset(self, data, suffix=""):
        """Reset the chat history."""
        if not self.allow_reset:
            raise JsonHandlerError(403, "Reset is disabled.")
        self.sessions.append([])
        self.finished = False
        return {}
