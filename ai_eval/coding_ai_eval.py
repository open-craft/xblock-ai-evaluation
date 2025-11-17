"""Coding Xblock with AI evaluation."""

import logging
import pkg_resources

from django.conf import settings
from django.utils.translation import gettext_noop as _
from web_fragments.fragment import Fragment
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Dict, List, Scope, String
from xblock.validation import ValidationMessage

from .base import AIEvalXBlock
from .llm_services import TIMEOUT_ERROR_MESSAGE
from .utils import (
    SUPPORTED_LANGUAGE_MAP,
    LanguageLabels,
)
from .backends.factory import BackendFactory

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
        Scope=Scope.settings,
    )

    evaluation_prompt = String(
        display_name=_("Evaluation prompt"),
        help=_(
            "Enter the evaluation prompt given to the model."
            " The question will be inserted right after it."
            " The student's answer would then follow the question. Markdown format can be used."
        ),
        default="You are a teacher. Evaluate the student's answer for the following question:",
        multiline_editor=True,
        scope=Scope.settings,
    )

    question = String(
        display_name=_("Question"),
        help=_(
            "Enter the question you would like the students to answer."
            " Markdown format can be used."
        ),
        default="",
        multiline_editor=True,
        scope=Scope.settings,
    )

    # XXX: deprecated
    messages = Dict(scope=Scope.user_state)

    sessions = List(
        help=_("Dictionary with messages"),
        scope=Scope.user_state,
        default=[{USER_RESPONSE: "", AI_EVALUATION: "", CODE_EXEC_RESULT: {}}],
    )

    editable_fields = AIEvalXBlock.editable_fields + (
        "question",
        "evaluation_prompt",
        "judge0_api_key",
        "language",
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.messages:
            self.sessions = [self.messages]
            self.messages = {}
            self.save()

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
            "code": self.sessions[-1][USER_RESPONSE],
            "ai_evaluation": self.sessions[-1][AI_EVALUATION],
            "code_exec_result": self.sessions[-1][CODE_EXEC_RESULT],
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

        if not data.question:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR, _("Question field is mandatory")
                )
            )

        # Only enforce Judge0 API key when Judge0 backend is selected (or default)
        backend_config = getattr(settings, 'AI_EVAL_CODE_EXECUTION_BACKEND', {})
        backend_name = backend_config.get('backend', 'judge0')
        if (
            data.language != LanguageLabels.HTML_CSS
            and backend_name != 'custom'
            and not data.judge0_api_key
        ):
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
            response = self.get_llm_response(messages)
        except Exception as e:
            logger.error(
                f"Failed while making LLM request using model {self.model}. Error: {e}",
                exc_info=True,
            )
            if str(e) == TIMEOUT_ERROR_MESSAGE:
                raise JsonHandlerError(500, str(e)) from e
            raise JsonHandlerError(500, "A probem occurred. Please retry.") from e

        if response:
            self.sessions[-1][USER_RESPONSE] = data["code"]
            self.sessions[-1][AI_EVALUATION] = response
            self.sessions[-1][CODE_EXEC_RESULT] = {
                "stdout": data["stdout"],
                "stderr": data["stderr"],
            }
            return {"response": response}

        raise JsonHandlerError(500, "No AI Evaluation available. Please retry.")

    @XBlock.json_handler
    def submit_code_handler(self, data, suffix=""):  # pylint: disable=unused-argument
        """
        Submit code for execution.
        """
        backend = BackendFactory.get_backend(self.judge0_api_key)
        submission_id = backend.submit_code(data["user_code"], self.language)
        return {"submission_id": submission_id}

    @XBlock.json_handler
    def reset_handler(self, data, suffix=""):  # pylint: disable=unused-argument
        """
        Reset the Xblock.
        """
        self.sessions.append({
            USER_RESPONSE: "",
            AI_EVALUATION: "",
            CODE_EXEC_RESULT: {},
        })
        return {"message": "reset successful."}

    @XBlock.json_handler
    def get_submission_result_handler(
        self, data, suffix=""
    ):  # pylint: disable=unused-argument
        """
        Get code submission result.
        """
        backend = BackendFactory.get_backend(self.judge0_api_key)
        submission_id = data["submission_id"]
        return backend.get_result(submission_id)

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
