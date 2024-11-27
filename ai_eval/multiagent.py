import re
import textwrap
import typing

import pydantic
from django.utils.translation import gettext_noop as _
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Boolean, Dict, List, Scope, Set, String
from xblock.validation import ValidationMessage
from web_fragments.fragment import Fragment

from .base import AIEvalXBlock
from .llm import SupportedModels, get_llm_response


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
    Your goal is to provide enough opportunities for the learner to self-correct and progress naturally without premature intervention.
    Call the conversation complete and choose FINISH only under the following conditions:
    (1) The **learning objectives and evaluation criteria are fully met**,
    (2) The learner explicitly indicates they are done with the conversation, or
    (3) Progress **stalls** and it becomes evident that the learner cannot achieve the learning objectives after multiple attempts.
    Always finish the conversation when the learner requests.
    If the interaction is complete, choose 'FINISH'.
    Learning Objectives: {learning_objectives}
    Evaluation Criteria: {evaluation_criteria}
""").strip()


DEFAULT_SUPERVISOR_PROMPT_2 = textwrap.dedent("""
    Who should act next? Choose from: ['Character', 'Coach', 'FINISH']
""").strip()


DEFAULT_AGENT_PROMPT = textwrap.dedent("""
    You are {character_name}.
    Case Details: {case_details}.
    You are speaking to {user_character_name}, who is described as: {user_character_info}.
    Speak in a dialogue fashion, naturally and succinctly.
    Do not do the work for the student. If the student tries to get you to answer the questions you are asking them to supply information on, redirect them to the task.
    Do not present tables, lists, or detailed written explanations. For instance, do not say 'the main goals include: 1. ...'
    Output only dialogue.
""").strip()


DEFAULT_AGENT_PROMPT_EXTRA = textwrap.dedent("""
    Learning Objectives: {learning_objectives}
    Evaluation Criteria: {evaluation_criteria}
""").strip()


DEFAULT_AGENT_PROMPT_PERSONALITY = textwrap.dedent("""
    Personality details: {professional_summary}
    Key competencies: {key_competencies}
    Behavioral profile: {behavioral_profile}
""").strip()


DEFAULT_EVALUATOR_PROMPT = textwrap.dedent("""
    You are an evaluator responsible for generating an evaluation report after the conversation has concluded.
    Use the provided chat history to evaluate the learner based on the evaluation criteria.
    Do not engage in any conversation or provide feedback directly to the learner.
    Your task is to produce a well-structured markdown report in the following format:

    # Evaluation Report

    {criteria}

    Your response must adhere to this exact structure, and each score must have a detailed rationale that includes at least one direct quote from the chat history.
    If you cannot find a direct quote, mention this explicitly and provide an explanation.
""").strip()


DEFAULT_CRITERION_TEMPLATE = textwrap.dedent("""
    ## {name}
    ### Score: (0-5)/5
    **Rationale**: Provide a rationale for the score, using specific direct quotes from the conversation as evidence.
""").strip()


class Scenario(pydantic.BaseModel):
    initial_message: str
    title: str


class CharacterNames(pydantic.BaseModel):
    main_character: str
    coach: str
    user_character: str


class EvaluationCriterion(pydantic.BaseModel):
    name: str


class ScenarioData(pydantic.BaseModel):
    scenario: Scenario
    characters: CharacterNames
    evaluation_criteria: typing.List[EvaluationCriterion]


class Character(pydantic.BaseModel):
    name: str


class CharacterData(pydantic.BaseModel):
    characters: typing.List[Character]


class MultiAgentAIEvalXBlock(AIEvalXBlock):
    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Multi-agent AI Evaluation",
        scope=Scope.settings,
    )

    supervisor_prompt_1 = String(
        display_name=_("Supervisor prompt part 1"),
        help=_(
            "Prompt used to instruct the model how to choose the next agent."
        ),
        multiline_editor=True,
        default=DEFAULT_SUPERVISOR_PROMPT_1,
        scope=Scope.settings,
    )

    supervisor_prompt_2 = String(
        display_name=_("Supervisor prompt part 2"),
        help=_(
            "Second part of the prompt used to instruct the model how to "
            "choose the next agent. This is either concatenated with the "
            "first prompt or given as a separate system prompt depending "
            "on support by the model in use."
        ),
        multiline_editor=True,
        default=DEFAULT_SUPERVISOR_PROMPT_2,
        scope=Scope.settings,
    )

    agent_prompt = String(
        display_name=_("Agent prompt"),
        help=_(
            "Prompt used to instruct the model how to act as an agent."
        ),
        multiline_editor=True,
        default=DEFAULT_AGENT_PROMPT,
        scope=Scope.settings,
    )

    agent_prompt_personality = String(
        multiline_editor=True,
        default=DEFAULT_AGENT_PROMPT_PERSONALITY,
        scope=Scope.settings,
    )

    agent_prompt_extra = String(
        multiline_editor=True,
        default=DEFAULT_AGENT_PROMPT_EXTRA,
        scope=Scope.settings,
    )

    evaluator_prompt = String(
        display_name=_("Evaluator prompt"),
        help=_(
            "Prompt used to instruct the model how to evaluate the learner."
        ),
        multiline_editor=True,
        default=DEFAULT_EVALUATOR_PROMPT,
        scope=Scope.settings,
    )

    criteria_template = String(
        display_name=_("Evaluation criteria template"),
        help=_(
            "Template for formatting evaluation criteria. "
            "Will replace '{criteria}' in Evaluator prompt."
        ),
        multiline_editor=True,
        default=DEFAULT_CRITERION_TEMPLATE,
        scope=Scope.settings,
    )

    agent_prompt_extra_roles = Set(
        default=["Coach", "Evaluator"],
        scope=Scope.settings,
    )

    scenario_data = Dict(
        scope=Scope.settings,
    )

    character_data = Dict(
        scope=Scope.settings,
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

    agents = List(
        scope=Scope.user_state,
        default=[],
    )

    editable_fields = list(AIEvalXBlock.editable_fields)
    editable_fields.remove("question")
    editable_fields.remove("evaluation_prompt")
    editable_fields += (
        "scenario_data",
        "character_data",
        "supervisor_prompt_1",
        "supervisor_prompt_2",
        "agent_prompt",
        "evaluator_prompt",
        "criteria_template",
    )
    editable_fields = tuple(editable_fields)

    def _chat_history(self):
        yield {
            "role": "assistant",
            "content": "[Character] " + self.initial_message,
        }
        yield from super()._chat_history()

    def validate_field_data(self, validation, data):
        super().validate_field_data(validation, data)

        try:
            ScenarioData(**data.scenario_data)
        except pydantic.ValidationError as e:
            for error in e.errors():
                field = error["loc"][0]
                msg = error["msg"]
                validation.add(ValidationMessage(
                    ValidationMessage.ERROR, f"Scenario data: {field!r}: {msg}"
                ))
        try:
            CharacterData(**data.character_data)
        except pydantic.ValidationError as e:
            for error in e.errors():
                field = error["loc"][0]
                validation.add(ValidationMessage(
                    ValidationMessage.ERROR, f"Character data: {field!r}: {msg}"
                ))

        try:
            data.agent_prompt.format(
                character_name="",
                user_character_name="",
                user_character_info="",
                **data.scenario_data.get("scenario", {}),
            )
        except KeyError as e:
            validation.add(ValidationMessage(ValidationMessage.ERROR, str(e)))

        for character in data.character_data.get("characters", []):
            try:
                data.agent_prompt_personality.format(**character)
            except KeyError as e:
                validation.add(
                    ValidationMessage(ValidationMessage.ERROR, str(e))
                )

        # TODO: check if all characters are provided

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

    @property
    def initial_message(self):
        try:
            return self.scenario_data["scenario"]["initial_message"]
        except KeyError:
            return ""

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
        js_data = {
            "messages": self.messages,
            "agents": self.agents,
            "initial_message": self.initial_message,
            "finished": self.finished,
            "marked_html": marked_html,
        }
        frag.initialize_js("MultiAgentAIEvalXBlock", js_data)
        return frag

    def _get_next_agent(self, user_input):
        prompt_1 = self.supervisor_prompt_1.format(
            **self.scenario_data,
            **self.scenario_data["scenario"],
        )
        prompt_2 = self.supervisor_prompt_2.format(
            **self.scenario_data,
            **self.scenario_data["scenario"],
        )
        messages = []
        if self.model == SupportedModels.CLAUDE_SONNET.value:
            prompt = prompt_1 + "\n" + prompt_2
            messages.append({"role": "system", "content": prompt})
            messages.append({"role": "user", "content": "."})
            messages.extend(self._chat_history())
            messages.append({"role": "user", "content": user_input})
            messages.append({"role": "assistant", "content": "[Supervisor]"})
        else:
            messages.append({"role": "system", "content": prompt_1})
            messages.extend(self._chat_history())
            messages.append({"role": "user", "content": user_input})
            messages.append({"role": "system", "content": prompt_2})
        response = get_llm_response(
            self.model, self.model_api_key, messages, self.model_api_url
        ).strip()
        for choice in ["Character", "Coach", "FINISH"]:
            if re.search(fr"\b{re.escape(choice)}\b", response, re.I):
                return choice
        raise RuntimeError(f"bad response {response!r}")

    def _get_character_name(self, role):
        characters_info = self.scenario_data["characters"]
        if role == "FINISH":
            return None
        elif role == "Character":
            return characters_info["main_character"]
        elif role == "Coach":
            return characters_info["coach"]
        else:
            raise ValueError(f"unknown role {role!r}")

    def _get_character_data(self, character_name):
        for character_data in self.character_data["characters"]:
            if character_data["name"] == character_name:
                return character_data

    def _get_agent_response(self, role, user_input):
        if role == "FINISH":
            criteria = "\n\n".join(map(
                self.criteria_template.format_map,
                self.scenario_data["evaluation_criteria"],
            ))
            prompt = self.evaluator_prompt.format(criteria=criteria)
        else:
            scenario = self.scenario_data["scenario"]
            characters_info = self.scenario_data["characters"]

            user_character_name = characters_info["user_character"]
            character_name = self._get_character_name(role)
            personality = self._get_character_data(character_name)
            user_character_data = self._get_character_data(user_character_name)
            prompt = self.agent_prompt.format(
                character_name=character_name,
                user_character_name=user_character_name,
                user_character_info=user_character_data,
                **scenario,
            )
            if personality:
                prompt += "\n" + self.agent_prompt_personality.format(
                    **personality
                )
            # Add learning objectives and evaluation criteria for specific roles.
            if role in self.agent_prompt_extra_roles:
                prompt += "\n" + self.agent_prompt_extra.format(
                    **self.scenario_data,
                    **self.scenario_data["scenario"],
                )

        system_msg = {"content": prompt, "role": "system"}
        messages = [system_msg]
        if self.model == SupportedModels.CLAUDE_SONNET.value:
            messages.append({"role": "user", "content": "."})
        messages.extend(self._chat_history())
        messages.append({"role": "user", "content": user_input})
        if role == "FINISH" and self.model == SupportedModels.CLAUDE_SONNET.value:
            messages.append({"role": "assistant", "content": "[Evaluator]"})
        response = get_llm_response(
            self.model, self.model_api_key, messages, self.model_api_url
        )
        return response

    @XBlock.json_handler
    def get_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Get LLM feedback"""
        # We use the LLM twice here: one time to decide which character to use,
        # and one time to act as that character.

        if self.finished:
            raise JsonHandlerError(403, "The session has ended.")

        force_finish = data.get("force_finish", False)
        if force_finish:
            user_input = ""
            role = "FINISH"
        else:
            user_input = str(data["user_input"])
            role = self._get_next_agent(user_input)

        message = self._get_agent_response(role, user_input or ".")
        self.messages[self.USER_KEY].append(user_input)
        self.messages[self.LLM_KEY].append(message)
        if role == "FINISH":
            self.finished = True
            character_name = None
        else:
            character_name = self._get_character_name(role)
        self.agents.append({"role": role, "character_name": character_name})
        return {
            "role": role,
            "message": message,
            "finished": self.finished,
            "character_name": character_name,
        }

    @XBlock.json_handler
    def reset(self, data, suffix=""):
        """
        Reset the Xblock.
        """
        if not self.allow_reset:
            raise JsonHandlerError(403, "Reset is disabled.")
        self.messages = {self.USER_KEY: [], self.LLM_KEY: []}
        self.agents = []
        self.finished = False
        return {}
