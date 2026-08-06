"""Coding Xblock with AI evaluation."""

import logging
import traceback
import pkg_resources


from django.utils.translation import gettext_noop as _
from web_fragments.fragment import Fragment
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Dict, Scope, String
from xblock.validation import ValidationMessage

from .llm import get_llm_response
from .base import AIEvalXBlock
from .utils import (
    submit_code,
    get_submission_result,
    SUPPORTED_LANGUAGE_MAP,
    LanguageLabels,
)

logger = logging.getLogger(__name__)

USER_RESPONSE = "USER_RESPONSE"
AI_EVALUATION = "AI_EVALUATION"
CODE_EXEC_RESULT = "CODE_EXEC_RESULT"


class CodingAIEvalXBlock(AIEvalXBlock):
    """
    TO-DO: document what your XBlock does.
    """

    has_author_view = True

    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Coding with AI Evaluation",
        scope=Scope.settings,
    )

    judge0_api_key = String(
        display_name=_("Judge0 API Key"),
        help=_(
            "Enter your the Judge0 API key used to execute code on Judge0."
            " Get your key at https://rapidapi.com/judge0-official/api/judge0-ce."
        ),
        default="",
        scope=Scope.settings,
    )

    language = String(
        display_name=_("Programming Language"),
        help=_("The programming language used for this Xblock."),
        values=[
            {"display_name": language, "value": language}
            for language in SUPPORTED_LANGUAGE_MAP
        ],
        default=LanguageLabels.Python,
        scope=Scope.settings,
    )
    messages = Dict(
        help=_("Dictionary with messages"),
        scope=Scope.user_state,
        default={USER_RESPONSE: "", AI_EVALUATION: "", CODE_EXEC_RESULT: {}},
    )

    editable_fields = AIEvalXBlock.editable_fields + ("judge0_api_key", "language")

    def resource_string(self, path):
        """Handy helper for getting resources from our kit."""
        data = pkg_resources.resource_string(__name__, path)
        return data.decode("utf8")

    def student_view(self, context=None):
        """
        The primary view of the CodingAIEvalXBlock, shown to students
        when viewing courses.
        """
        html = self.loader.render_django_template(
            "/templates/coding_ai_eval.html",
            {
                "self": self,
            },
        )

        frag = Fragment(html)
        frag.add_css(self.resource_string("static/css/coding_ai_eval.css"))
        frag.add_javascript(self.resource_string("static/js/src/utils.js"))

        frag.add_javascript(self.resource_string("static/js/src/coding_ai_eval.js"))

        monaco_html = self.loader.render_django_template(
            "/templates/monaco.html",
            {
                "monaco_language": SUPPORTED_LANGUAGE_MAP[self.language].monaco_id,
            },
        )
        marked_html = self.resource_string("static/html/marked-iframe.html")
        js_data = {
            "monaco_html": monaco_html,
            "question": self.question,
            "code": self.messages[USER_RESPONSE],
            "ai_evaluation": self.messages[AI_EVALUATION],
            "code_exec_result": self.messages[CODE_EXEC_RESULT],
            "marked_html": marked_html,
            "language": self.language,
        }
        frag.initialize_js("CodingAIEvalXBlock", js_data)
        return frag

    def author_view(self, context=None):
        """
        Create preview to be show to course authors in Studio.
        """
        if not self.validate():
            fragment = Fragment()
            fragment.add_content(
                _(
                    "To ensure this component works correctly, please fix the validation issues."
                )
            )
            return fragment

        return self.student_view(context=context)

    def validate_field_data(self, validation, data):
        """
        Validate fields
        """

        super().validate_field_data(validation, data)

        if data.language != LanguageLabels.HTML_CSS and not data.judge0_api_key:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR, _("Judge0 API key is mandatory")
                )
            )

    @XBlock.json_handler
    def get_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Get LLM feedback."""

        answer = f"""
        student code :

        {data['code']}
        """

        # stdout and stderr only for executable languages (non HTML)
        if self.language != LanguageLabels.HTML_CSS:
            answer += f"""
            stdout:

            {data['stdout']}

            stderr:

            {data['stderr']}
            """

        messages = [
            {
                "role": "system",
                "content": f"""
               {self.evaluation_prompt}

               {self.question}.

               The programmimg language is {self.language}

               Evaluation must be in Makrdown format.
               """,
            },
            {
                "content": f""" Here is the student's answer:
              {answer}
                """,
                "role": "user",
            },
        ]

        try:
            response = get_llm_response(
                self.model,
                self.get_model_api_key(),
                messages,
                self.get_model_api_url(),
            )

        except Exception as e:
            traceback.print_exc()
            logger.error(
                f"Failed while making LLM request using model {self.model}. Eaised error type: {type(e)}, Error: {e}"
            )
            raise JsonHandlerError(500, "A probem occured. Please retry.") from e

        if response:
            self.messages[USER_RESPONSE] = data["code"]
            self.messages[AI_EVALUATION] = response
            self.messages[CODE_EXEC_RESULT] = {
                "stdout": data["stdout"],
                "stderr": data["stderr"],
            }
            return {"response": response}

        raise JsonHandlerError(500, "No AI Evaluation available. Please retry.")

    @XBlock.json_handler
    def submit_code_handler(self, data, suffix=""):  # pylint: disable=unused-argument
        """
        Submit code to Judge0.
        """
        submission_id = submit_code(
            self.judge0_api_key, data["user_code"], self.language
        )
        return {"submission_id": submission_id}

    @XBlock.json_handler
    def reset_handler(self, data, suffix=""):  # pylint: disable=unused-argument
        """
        Reset the Xblock.
        """
        self.messages = {USER_RESPONSE: "", AI_EVALUATION: "", CODE_EXEC_RESULT: {}}
        return {"message": "reset successful."}

    @XBlock.json_handler
    def get_submission_result_handler(
        self, data, suffix=""
    ):  # pylint: disable=unused-argument
        """
        Get code submission result.
        """
        submission_id = data["submission_id"]
        return get_submission_result(self.judge0_api_key, submission_id)

    @staticmethod
    def workbench_scenarios():
        """A canned scenario for display in the workbench."""
        return [
            (
                "CodingAIEvalXBlock",
                """<coding_ai_eval/>
             """,
            ),
            (
                "Multiple CodingAIEvalXBlock",
                """<vertical_demo>
                <coding_ai_eval/>
                <coding_ai_eval/>
                <coding_ai_eval/>
                </vertical_demo>
             """,
            ),
        ]
