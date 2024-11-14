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
from .llm import SupportedModels


DEFAULT_SUPERVISOR_PROMPT_1 = textwrap.dedent("""
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
""").strip()


DEFAULT_SUPERVISOR_PROMPT_2 = textwrap.dedent("""
    Who should act next? Choose from: ['Character', 'Coach', 'FINISH']
""").strip()


DEFAULT_AGENT_PROMPT = textwrap.dedent("""
    You are {{ character_name }}.

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
    You are speaking to {{ user_character_name }}, who is described as: {{ user_character_data }}.
    Speak in a dialogue fashion, naturally and succinctly.
    Do not do the work for the student. If the student tries to get you to answer the questions you are asking them to supply information on, redirect them to the task.
    Do not present tables, lists, or detailed written explanations. For instance, do not say 'the main goals include: 1. ...'
    Output only dialogue.
""").strip()


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
""").strip()


class Scenario(pydantic.BaseModel):
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
    _jinja_env = SandboxedEnvironment(undefined=jinja2.StrictUndefined)

    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Multi-agent AI Evaluation",
        scope=Scope.settings,
    )

    supervisor_prompt_1 = String(
        display_name=_("Supervisor prompt part 1"),
        help=_(
            'Prompt used to instruct the model how to choose the next agent. '
            'Instruct it to choose between one of the roles in "Role '
            'characters" or the command specified in "Supervisor finish '
            'command".'
        ),
        multiline_editor=True,
        default=DEFAULT_SUPERVISOR_PROMPT_1,
        scope=Scope.settings,
    )

    supervisor_prompt_2 = String(
        display_name=_("Supervisor prompt part 2"),
        help=_(
            'Second part of the prompt used to instruct the model how to '
            'choose the next agent. '
            'Instruct it to choose between one of the roles in "Role '
            'characters" or the command specified in "Supervisor finish '
            'command".'
        ),
        multiline_editor=True,
        default=DEFAULT_SUPERVISOR_PROMPT_2,
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
        help=_("Prefill used to hint the model to act as the Supervisor"),
        scope=Scope.settings,
        default=_("[Supervisor]"),
    )

    evaluator_prefill = String(
        display_name=_("Prefill for evaluator reply"),
        help=_("Prefill used to hint the model to act as the Evaluator"),
        scope=Scope.settings,
        default=_("[Evaluator]"),
    )

    role_characters = Dict(
        display_name=_("Role characters"),
        help=_(
            "Mapping of roles used by the Supervisor to character keys "
            "in scenario data"
        ),
        scope=Scope.settings,
        default={
            _("User"): "user_character",
            _("Character"): "main_character",
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
                "main_character": "Jack",
                "coach": "Maya",
                "user_character": "Alex",
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

    finished = Boolean(
        scope=Scope.user_state,
        default=False,
    )

    chat_history = List(
        scope=Scope.user_state,
        default=[],
    )

    editable_fields = list(AIEvalXBlock.editable_fields)
    editable_fields += (
        "scenario_data",
        "character_data",
        "supervisor_prompt_1",
        "supervisor_prompt_2",
        "role_characters",
        "finish_command",
        "agent_prompt",
        "evaluator_prompt",
        "supervisor_prefill",
        "evaluator_prefill",
        "allow_reset",
    )
    editable_fields = tuple(editable_fields)

    def studio_view(self, context):
        """
        Render a form for editing this XBlock
        """
        fragment = super().studio_view(context)
        fragment.add_javascript(self.resource_string("static/js/src/multiagent_edit.js"))
        # MultiAgentAIEvalXBlock() in multiagent_edit.js will call
        # StudioEditableXBlockMixin().
        fragment.initialize_js("MultiAgentAIEvalXBlock")
        return fragment

    def _render_template(self, template, **context):
        return self._jinja_env.from_string(template).render(context)

    def _get_character(self, key):
        for role, k in self.role_characters.items():
            if k == key:
                name = self._get_character_name(role)
                data = self._get_character_data(name)
                return role, data
        return "", {}

    def _chat_history_for_llm(self, user_input):
        if self.model == SupportedModels.CLAUDE_SONNET.value:
            # Claude needs a dummy user reply before the first assistant reply.
            yield {"role": "user", "content": "."}

        main_role, main_data = self._get_character("main_character")
        user_role, user_data = self._get_character("user_character")
        initial_message = {
            "role": "assistant",
            "content": self.scenario_data["scenario"]["initial_message"],
            "extra": {
                "role": main_role,
                "character_data": main_data,
            },
        }
        user_message = {
            "role": "user",
            "content": user_input or ".",
        }
        for message in itertools.chain([initial_message],
                                       self.chat_history,
                                       [user_message]):
            content = message["content"]
            if message["role"] == "assistant":
                character_role = message["extra"]["role"]
                character_data = message["extra"]["character_data"]
            else:
                character_role = user_role
                character_data = user_data
            content = (
                f"{character_data.get('name', '')} "
                f"({character_role}, {character_data.get('role', '')}): "
                f"{content}"
            )
            yield {"content": content, "role": message["role"]}

    def _get_field_display_name(self, field_name):
        return self.fields[field_name].display_name

    def validate_field_data(self, validation, data):
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

        for prompt_field in ['supervisor_prompt_1', 'supervisor_prompt_2',
                             'evaluator_prompt']:
            try:
                self._render_template(getattr(data, prompt_field),
                                      scenario_data=data.scenario_data)
            except jinja2.TemplateError as e:
                validation.add(ValidationMessage(
                    ValidationMessage.ERROR,
                    f"{self._get_field_display_name(prompt_field)}: {e}",
                ))

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

        for i, character_data in enumerate(data.character_data.get("characters", [])):
            # Character name is validated above but may be missing yet.
            character_name = character_data.get("name", "")
            role = ""
            for key, name in data.scenario_data.get("characters", {}).items():
                if name == character_name:
                    for r, k in data.role_characters.items():
                        if k == key:
                            role = r
                            break
                    break
            try:
                self._render_template(
                    data.agent_prompt,
                    role=role,
                    character_name=character_name,
                    character_data=character_data,
                    user_character_name="",
                    user_character_data="",
                    scenario_data=data.scenario_data,
                )
            except jinja2.TemplateError as e:
                validation.add(ValidationMessage(
                    ValidationMessage.ERROR,
                    (
                        f"{self._get_field_display_name('agent_prompt')}/"
                        f"{self._get_field_display_name('character_data')}[{i}]: "
                        f"{e}"
                    ),
                ))

    def student_view(self, context=None):
        """
        The primary view of the MultiAgentAIEvalXBlock, shown to students
        when viewing courses.
        """

        frag = Fragment()
        frag.add_content(
            self.loader.render_django_template(
                "/templates/multiagent.html",
                {"self": self},
            )
        )
        frag.add_css(self.resource_string("static/css/shortanswer.css"))
        frag.add_javascript(self.resource_string("static/js/src/utils.js"))
        frag.add_javascript(self.resource_string("static/js/src/multiagent.js"))
        marked_html = self.resource_string("static/html/marked-iframe.html")
        main_character_role = ""
        main_character_data = {}
        for role, key in self.role_characters.items():
            if key == "main_character":
                main_character_role = role
                main_character_name = self._get_character_name(role)
                main_character_data = self._get_character_data(main_character_name)
                break
        js_data = {
            "messages": self.chat_history,
            "main_character_role": main_character_role,
            "main_character_data": main_character_data,
            "initial_message": self.scenario_data["scenario"]["initial_message"],
            "finished": self.finished,
            "marked_html": marked_html,
        }
        frag.initialize_js("MultiAgentAIEvalXBlock", js_data)
        return frag

    def _get_next_agent(self, user_input):
        prompt_1 = self._render_template(self.supervisor_prompt_1,
                                         scenario_data=self.scenario_data)
        prompt_2 = self._render_template(self.supervisor_prompt_2,
                                         scenario_data=self.scenario_data)
        if self.model == SupportedModels.CLAUDE_SONNET.value:
            # Claude needs a single system prompt.
            prompt_1 = prompt_1 + "\n" + prompt_2
            prompt_2 = None
            supervisor_prefill = self.supervisor_prefill
        else:
            supervisor_prefill = None
        messages = [{"role": "system", "content": prompt_1}]
        messages.extend(self._chat_history_for_llm(user_input))
        if prompt_2:
            messages.append({"role": "system", "content": prompt_2})
        if supervisor_prefill:
            messages.append({"role": "assistant", "content": supervisor_prefill})
        response = self.get_llm_response(messages).strip()
        for choice in self.role_characters.keys():
            if re.search(fr"\b{re.escape(choice)}\b", response, re.I):
                return choice
        if re.search(fr"\b{re.escape(self.finish_command)}\b", response):
            return self.finish_command
        raise RuntimeError(f"bad response {response!r}")

    def _get_character_name(self, role):
        if role == self.finish_command:
            return None
        key = self.role_characters[role]
        return self.scenario_data["characters"][key]

    def _get_character_data(self, character_name):
        for character_data in self.character_data["characters"]:
            if character_data["name"] == character_name:
                return character_data

    def _get_agent_response(self, role, user_input):
        user_character_name = self.scenario_data["characters"]["user_character"]
        user_character_data = self._get_character_data(user_character_name)
        character_name = self._get_character_name(role)
        character_data = self._get_character_data(character_name)
        prompt = self._render_template(
            self.agent_prompt,
            scenario_data=self.scenario_data,
            role=role,
            character_data=character_data,
            character_name=character_name,
            user_character_data=user_character_data,
            user_character_name=user_character_name,
        )
        messages = [{"role": "system", "content": prompt}]
        messages.extend(self._chat_history_for_llm(user_input))
        response = self.get_llm_response(messages)
        response = re.sub((fr'^({re.escape(role)}|{re.escape(character_name)})'
                           fr'\s*0(\([^\)]*\))?:\s*'),
                          '', response, count=1)
        return response

    def _get_evaluator_response(self, user_input):
        prompt = self._render_template(self.evaluator_prompt,
                                       scenario_data=self.scenario_data)
        if self.model == SupportedModels.CLAUDE_SONNET.value:
            evaluator_prefill = self.evaluator_prefill
        else:
            evaluator_prefill = None
        messages = [{"role": "system", "content": prompt}]
        messages.extend(self._chat_history_for_llm(user_input))
        if evaluator_prefill:
            messages.append({"role": "assistant", "content": evaluator_prefill})
        response = self.get_llm_response(messages)
        return response

    @XBlock.json_handler
    def get_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Get LLM feedback"""
        # We use the LLM twice here: one time to decide which character to use,
        # and one time to act as that character.

        if self.finished:
            raise JsonHandlerError(403, "The session has ended.")

        if data.get("force_finish", False):
            user_input = ""
            role = None
            is_evaluator = True
        else:
            user_input = str(data["user_input"])
            role = self._get_next_agent(user_input)
            is_evaluator = (role == self.finish_command)

        if is_evaluator:
            message = self._get_evaluator_response(user_input)
        else:
            message = self._get_agent_response(role, user_input)
        if is_evaluator:
            self.finished = True
            character_data = None
        else:
            character_name = self._get_character_name(role)
            character_data = self._get_character_data(character_name)
        self.chat_history.append({"role": "user", "content": user_input})
        extra = {"is_evaluator": is_evaluator, "role": role,
                 "character_data": character_data}
        self.chat_history.append({"role": "assistant", "content": message,
                                  "extra": extra})
        return {"message": message, "finished": self.finished, **extra}

    @XBlock.json_handler
    def reset(self, data, suffix=""):
        """
        Reset the Xblock.
        """
        if not self.allow_reset:
            raise JsonHandlerError(403, "Reset is disabled.")
        self.chat_history = []
        self.finished = False
        return {}
