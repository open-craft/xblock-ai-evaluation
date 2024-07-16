"""Short answers Xblock with AI evaluation."""

import logging
import traceback


from django.utils.translation import gettext_noop as _
from web_fragments.fragment import Fragment
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Integer, String, Scope
from xblock.validation import ValidationMessage

from .llm import get_llm_response
from .base import AIEvalXBlock


logger = logging.getLogger(__name__)


class ShortAnswerAIEvalXBlock(AIEvalXBlock):
    """
    Short Answer Xblock.
    """

    icon_class = "problem"

    display_name = String(
        display_name=_("Display Name"),
        help=_("Enter the name that students see for this component."),
        default="Short answer with AI Evaluation",
        scope=Scope.settings,
    )

    max_responses = Integer(
        display_name=_("Max Responses"),
        help=_("The maximum number of response messages the student can submit"),
        scope=Scope.settings,
        default=3,
    )

    editable_fields = AIEvalXBlock.editable_fields + ("max_responses",)

    def validate_field_data(self, validation, data):
        """
        Validate fields
        """

        super().validate_field_data(validation, data)

        if not data.max_responses or data.max_responses <= 0 or data.max_responses > 9:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    _("max responses must be an integer between 1 and 9"),
                )
            )

    def student_view(self, context=None):
        """
        The primary view of the ShortAnswerAIEvalXBlock, shown to students
        when viewing courses.
        """

        frag = Fragment()
        frag.add_content(
            self.loader.render_django_template(
                "/templates/shortanswer.html",
                {
                    "self": self,
                },
            )
        )

        frag.add_css(self.resource_string("static/css/shortanswer.css"))
        frag.add_javascript(self.resource_string("static/js/src/utils.js"))
        frag.add_javascript(self.resource_string("static/js/src/shortanswer.js"))

        js_data = {
            "question": self.question,
            "messages": self.messages,
            "max_responses": self.max_responses,
        }
        frag.initialize_js("ShortAnswerAIEvalXBlock", js_data)
        return frag

    @XBlock.json_handler
    def get_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Get LLM feedback"""
        user_submission = str(data["user_input"])
        system_msg = {
            "role": "system",
            "content": f"""
               {self.evaluation_prompt}

               {self.question}.

               Evaluation must be in Makrdown format.
               """,
        }
        messages = [system_msg]
        # add previous messages
        # the first AI role is 'system' which defines the LLM's personnality and behavior.
        # subsequent roles are 'assistant' and 'user'
        for i in range(len(self.messages[self.USER_KEY])):
            messages.append(
                {"content": self.messages[self.USER_KEY][i], "role": "user"}
            )
            messages.append(
                {"content": self.messages[self.LLM_KEY][i], "role": "assistant"}
            )

        messages.append({"role": "user", "content": user_submission})

        try:
            response = get_llm_response(
                self.model, self.model_api_key, messages, self.model_api_url
            )

        except Exception as e:
            traceback.print_exc()
            logger.error(
                f"Failed while making LLM request using model {self.model}. Eaised error type: {type(e)}, Error: {e}"
            )
            raise JsonHandlerError(500, "A probem occured. Please retry.") from e

        if response:
            self.messages[self.USER_KEY].append(user_submission)
            self.messages[self.LLM_KEY].append(response)
            return {"response": response}

        raise JsonHandlerError(500, "A probem occured. The LLM sent an empty response.")

    @staticmethod
    def workbench_scenarios():
        """A canned scenario for display in the workbench."""
        return [
            (
                "ShortAnswerAIEvalXBlock",
                """<shortanswer/>
             """,
            ),
            (
                "Multiple ShortAnswerAIEvalXBlock",
                """<vertical_demo>
                <shortanswer/>
                <shortanswer/>
                </vertical_demo>
             """,
            ),
        ]
