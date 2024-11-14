from django.utils.translation import gettext_noop as _
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Boolean, Dict, List, Scope, Set, String
from web_fragments.fragment import Fragment

from .base import AIEvalXBlock
from .llm import get_llm_response


DEFAULT_SUPERVISOR_PROMPT = (
    "You are a supervisor managing an interaction between the following "
    "agents: Coach, Character. "
    "Based on the conversation, decide which agent should respond next. "
    "You can choose from: Character, Coach, or FINISH. "
    "You are responsible for managing the flow of the conversation between "
    "agents. The conversation should flow naturally with the Character until "
    "specific conditions are met. Switch control to the Coach only under the "
    "following conditions: "
    "(1) The learner makes the same mistake **three times in a row**. "
    "(2) The learner **explicitly** asks for help. "
    "(3) The learner gets **significantly off topic** and is no longer "
    "addressing the learning objectives or the project. "
    "If the learner shows minor deviations or uncertainty, let the Character "
    "continue interacting with the learner."
    "Your goal is to provide enough opportunities for the learner to "
    "self-correct and progress naturally without premature intervention."
    "Call the conversation complete only under the following conditions: "
    "(1) The **learning objectives and evaluation criteria are fully met**, "
    "(2) The learner explicitly indicates they are done with the "
    "conversation, or "
    "(3) Progress **stalls** and it becomes evident that the learner cannot "
    "achieve the learning objectives after multiple attempts. "
    "Do not choose any other options. "
    "If the interaction is complete, return 'FINISH'."
)

DEFAULT_AGENT_PROMPT = (
    "You are {character_name}. "
    "Case Details: {case_details}. "
    "You are speaking to {user_character_name}, who is described as: "
    "{user_character_info}. "
    "Speak in a dialogue fashion, naturally and succinctly. "
    "Do not do the work for the student. If the student tries to get you to "
    "answer the questions you are asking them to supply information on, "
    "redirect them to the task. "
    "Do not present tables, lists, or detailed written explanations. "
    "For instance, do not say 'the main goals include: 1. ...' "
)

DEFAULT_AGENT_PERSONALITY_PROMPT = (
    "Personality details: {professional_summary} "
    "Key competencies: {key_competencies}. "
    "Behavioral profile: {behavioral_profile}. "
)

DEFAULT_AGENT_EVALUATION_PROMPT = (
    "Learning Objectives: {learning_objectives}. "
    "Evaluation Criteria: {evaluation_criteria}. "
)

class MultiAgentAIEvalXBlock(AIEvalXBlock):
    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Multi-agent AI Evaluation",
        scope=Scope.settings,
    )

    supervisor_prompt = String(
        default=DEFAULT_SUPERVISOR_PROMPT,
        scope=Scope.settings,
    )

    agent_prompt = String(
        default=DEFAULT_AGENT_PROMPT,
        scope=Scope.settings,
    )

    agent_personality_prompt = String(
        default=DEFAULT_AGENT_PERSONALITY_PROMPT,
        scope=Scope.settings,
    )

    evaluation_prompt = String(
        default=DEFAULT_AGENT_EVALUATION_PROMPT,
        scope=Scope.settings,
    )

    evaluation_roles = Set(
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
    editable_fields += (
        "scenario_data",
        "character_data",
    )
    editable_fields = tuple(editable_fields)

    def student_view(self, context=None):
        """
        The primary view of the ShortAnswerAIEvalXBlock, shown to students
        when viewing courses.
        """

        frag = Fragment()
        frag.add_content(
            self.loader.render_django_template(
                "/templates/multiagent.html",
                {
                    "self": self,
                },
            )
        )

        frag.add_css(self.resource_string("static/css/shortanswer.css"))
        frag.add_javascript(self.resource_string("static/js/src/utils.js"))
        frag.add_javascript(self.resource_string("static/js/src/multiagent.js"))

        marked_html = self.resource_string("static/html/marked-iframe.html")

        try:
            initial_message = self.scenario_data["scenario"]["initial_message"]
        except KeyError:
            initial_message = ""

        js_data = {
            "messages": self.messages,
            "agents": self.agents,
            "marked_html": marked_html,
            "initial_message": initial_message
        }
        frag.initialize_js("MultiAgentAIEvalXBlock", js_data)
        return frag

    def _get_next_agent(self, user_input):
        system_msg = {"content": self.supervisor_prompt, "role": "system"}
        messages = [system_msg]
        messages.extend(self._chat_history())
        messages.append({"role": "user", "content": user_input})
        messages.append({"role": "system", "content": "Who should act next? Choose from: ['Character', 'Coach', 'FINISH']"})
        response = get_llm_response(
            self.model, self.model_api_key, messages, self.model_api_url
        )
        return response

    def _get_character_name(self, role):
        characters_info = self.scenario_data["characters"]
        if role == "Character":
            return characters_info["main_character"]
        elif role == "Coach":
            return characters_info["coach"]

    def _get_character_data(self, character_name):
        for character_data in self.character_data["characters"]:
            if character_data["name"] == character_name:
                return character_data

    def _get_agent_response(self, role, user_input):
        """Create a personality-based agent with prompts from JSON data."""
        if role == "FINISH":
            # TODO: refactor, make configurable.
            prompt = (
                "You are an evaluator responsible for generating an evaluation report after the conversation has concluded. "
                "Use the provided chat history to evaluate the learner based on the evaluation criteria. "
                "Do not engage in any conversation or provide feedback directly to the learner. "
                "Your task is to produce a well-structured markdown report in the following format:\n\n"
                "# Evaluation Report\n\n"
            )
            for criterion in self.scenario_data["evaluation_criteria"]:
                prompt += (
                    f"## {criterion['name']}\n"
                    f"### Score: (0-5)/5 \n"
                    f"**Rationale**: Provide a rationale for the score, using specific direct quotes from the conversation as evidence.\n\n"
                )
            prompt += (
                "Your response must adhere to this exact structure, and each score must have a detailed rationale that includes at least one direct quote from the chat history. "
                "If you cannot find a direct quote, mention this explicitly and provide an explanation."
            )
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
                prompt += self.agent_personality_prompt.format(**personality)
            # Add learning objectives and evaluation criteria for specific roles.
            if role in self.evaluation_roles:
                prompt += self.evaluation_prompt.format(
                    evaluation_criteria=self.scenario_data["evaluation_criteria"],
                    **scenario
                )

        system_msg = {"content": prompt, "role": "system"}
        messages = [system_msg]
        messages.extend(self._chat_history())
        messages.append({"role": "user", "content": user_input})
        response = get_llm_response(
            self.model, self.model_api_key, messages, self.model_api_url
        )
        return response

    @XBlock.json_handler
    def get_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Get LLM feedback"""
        # We use the LLM twice here: once to decide which character to use,
        # and once to act as that character.
        user_input = str(data["user_input"])

        if self.finished:
            raise JsonHandlerError(403, "The session has ended.")

        role = self._get_next_agent(user_input)
        message = self._get_agent_response(role, user_input)
        self.messages[self.USER_KEY].append(user_input)
        self.messages[self.LLM_KEY].append(message)
        character_name = self._get_character_name(role)
        self.agents.append({"role": role, "character_name": character_name})
        if role == "FINISH":
            self.finished = True
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
        return {}
