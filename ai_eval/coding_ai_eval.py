"""Coding Xblock with AI evaluation."""

import json
import logging
from importlib.resources import files

from django.conf import settings
from django.utils.translation import gettext_noop as _
from pygments import highlight
from pygments.formatters import HtmlFormatter  # pylint: disable=no-name-in-module
from pygments.lexers import get_lexer_by_name
from web_fragments.fragment import Fragment
from webob import Response
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Dict, List, Scope, String
from xblock.utils.resources import ResourceLoader
from xblock.utils.studio_editable import FutureFields

from .base import AIEvalXBlock
from .llm_services import TIMEOUT_ERROR_MESSAGE
from .utils import (
    SUPPORTED_LANGUAGE_MAP,
    LanguageLabels,
    now,
)
from .backends.factory import BackendFactory
from .pdf_generator import CodingData, CodingCode

logger = logging.getLogger(__name__)

resource_loader = ResourceLoader(__name__)

USER_RESPONSE = "USER_RESPONSE"
AI_EVALUATION = "AI_EVALUATION"
CODE_EXEC_RESULT = "CODE_EXEC_RESULT"
TIME = "TIME"


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
        return files("ai_eval").joinpath(path).read_text(encoding="utf8")

    def student_view(self, context=None):
        """
        The primary view of the CodingAIEvalXBlock, shown to students
        when viewing courses.
        """
        return self._render_preview()

    def _render_preview(self, context=None, is_studio: bool = False):
        """
        Shared preview rendering between student and author views.
        """
        frag = Fragment('<div data-ai-eval-react-root="true"></div>')

        # When rendering the student preview in studio, load studio-specific style fixes.
        if is_studio:
            frag.add_css(resource_loader.load_unicode("static/css/studio_fixes.css"))

        frag.add_javascript_url(self.runtime.local_resource_url(self, "static/bundles/coding.js"))

        monaco_html = self.loader.render_django_template(
            "/templates/monaco.html",
            {
                "monaco_language": SUPPORTED_LANGUAGE_MAP[self.language].monaco_id,
            },
        )
        current_session = self.sessions[-1]
        frag.initialize_js(
            "CodingAIEvalXBlock",
            self._build_view_payload(
                view="student",
                handler_urls={
                    "submit_code_handler": self.runtime.handler_url(self, "submit_code_handler"),
                    "get_submission_result_handler": self.runtime.handler_url(
                        self, "get_submission_result_handler"
                    ),
                    "get_response": self.runtime.handler_url(self, "get_response"),
                    "reset_handler": self.runtime.handler_url(self, "reset_handler"),
                    "download_pdf": self.runtime.handler_url(self, "download_pdf"),
                },
                initial_state={
                    "code": current_session[USER_RESPONSE],
                    "ai_evaluation": current_session[AI_EVALUATION],
                    "code_exec_result": current_session[CODE_EXEC_RESULT],
                },
                meta={
                    "question": self.question,
                    "language": self.language,
                    "monaco_html": monaco_html,
                    "pdf_download_allowed": self.pdf_download_allowed,
                    "pdf_download_title": self.pdf_download_title,
                    "pdf_download_description": self.pdf_download_description,
                },
                style_urls=[
                    "static/bundles/shared.css",
                    "static/css/coding_ai_eval.css",
                ],
            ),
        )
        return frag

    def studio_view(self, context=None):
        """
        Render the React Studio editor for Coding.
        """
        # Ideally we shouldn't need to define any HTML as the React App StudioUI should take care of everything.
        # However, the Studio Runtime for the XBlock looks for certain elements in the DOM to render it's wrapper.
        #
        # So, "editor-with-buttons" is defined to prevent the footer nativations from showing up.
        fragment = Fragment('<div data-ai-eval-react-root="true" class="editor-with-buttons is-active"></div>')
        fragment.add_css(resource_loader.load_unicode("static/css/studio_fixes.css"))
        fragment.add_javascript_url(self.runtime.local_resource_url(self, "static/bundles/coding.studio.js"))
        fragment.initialize_js(
            "CodingAIEvalXBlockStudio",
            self._build_view_payload(
                view="studio",
                handler_urls={
                    "studio_submit": self.runtime.handler_url(self, "studio_submit"),
                },
                initial_state=self._studio_initial_state(),
                meta=self._studio_payload_meta(),
                style_urls=[
                    "static/bundles/shared.css",
                    "static/css/studio_api_key_lock.css",
                    "static/css/shortanswer_studio.css",
                ]
            ),
        )
        return fragment

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

        return self._render_preview(context=context, is_studio=True)

    def _get_code_execution_backend_config(self):
        """Return code execution backend config from Django settings, or None if absent."""
        return getattr(settings, 'AI_EVAL_CODE_EXECUTION_BACKEND', None)

    def _is_judge0_backend_selected(self) -> bool:
        """Return true when the configured backend is judge0 (default)."""
        backend_config = self._get_code_execution_backend_config() or {}
        backend_name = backend_config.get('backend', 'judge0')
        return backend_name == 'judge0'

    def _is_judge0_api_key_configured(self) -> bool:
        """Return true when Judge0 API key is present in Django settings config."""
        backend_config = self._get_code_execution_backend_config() or {}
        judge0_config = backend_config.get('judge0_config', {})
        return bool(judge0_config.get('api_key'))

    def should_lock_judge0_api_key_field(self) -> bool:
        """Lock Judge0 field when runtime settings provide a Judge0 API key."""
        return self._is_judge0_backend_selected() and self._is_judge0_api_key_configured()

    def _studio_lock_metadata(self) -> dict:
        """Extend base lock payload with coding-specific Judge0 lock flag."""
        payload = super()._studio_lock_metadata()
        payload["lock_judge0_api_key"] = self.should_lock_judge0_api_key_field()
        return payload

    def _collect_studio_validation_issues(
        self,
        data,
    ) -> tuple[dict[str, list[str]], list[str]]:
        """
        Extend base Studio validation issues with Coding field rules.
        """
        validation_errors, validation_warnings = super()._collect_studio_validation_issues(data)

        if not data.question:
            self._add_studio_validation_error(
                validation_errors,
                "question",
                _("Question field is mandatory"),
            )

        has_backend_config = self._get_code_execution_backend_config() is not None
        missing_judge0_key = (
            (has_backend_config and not self._is_judge0_api_key_configured())
            or (not has_backend_config and not data.judge0_api_key)
        )

        # Only enforce Judge0 API key when Judge0 backend is selected (or default)
        if (
            data.language != LanguageLabels.HTML_CSS
            and self._is_judge0_backend_selected()
            and missing_judge0_key
        ):
            error_message = (
                _(
                    "Judge0 API key is mandatory in Django settings when "
                    "AI_EVAL_CODE_EXECUTION_BACKEND is configured."
                )
                if has_backend_config
                else _("Judge0 API key is mandatory")
            )
            self._add_studio_validation_error(
                validation_errors,
                "judge0_api_key",
                error_message,
            )

        return validation_errors, validation_warnings

    def validate_field_data(self, validation, data):
        """
        Validate fields.
        """
        validation_errors, validation_warnings = self._collect_studio_validation_issues(data)

        self._apply_studio_issues(
            validation,
            validation_errors,
            validation_warnings,
        )

        self._clear_cached_studio_warnings()

    @XBlock.json_handler
    def studio_submit(self, data, suffix=""):  # pylint: disable=unused-argument
        """
        Save the Studio editor payload using the existing field validation rules.
        """
        values = {}
        missing_fields = []
        for field_name in self.editable_fields:
            if field_name not in data:
                missing_fields.append(field_name)
                continue
            field = self.fields[field_name]
            values[field_name] = field.from_json(data[field_name])

        if missing_fields:
            validation_errors = {
                field_name: [_("Missing field in Studio payload.")]
                for field_name in missing_fields
            }
            return self._studio_submit_response(
                success=False,
                validation_errors=validation_errors,
                validation_warnings=[],
                meta=self._studio_payload_meta(),
            )

        self.clean_studio_edits(values)

        preview_data = FutureFields(
            new_fields_dict=values,
            newly_removed_fields=[],
            fallback_obj=self,
        )
        validation_errors, validation_warnings = self._collect_studio_validation_issues(
            preview_data,
        )
        self._clear_cached_studio_warnings()
        has_validation_errors = bool(validation_errors)

        if not has_validation_errors:
            for field_name, value in values.items():
                setattr(self, field_name, value)

        return self._studio_submit_response(
            success=not has_validation_errors,
            validation_errors=validation_errors,
            validation_warnings=validation_warnings,
            meta=self._studio_payload_meta(),
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
            self._replace_current_session({
                USER_RESPONSE: data["code"],
                AI_EVALUATION: response,
                CODE_EXEC_RESULT: {
                    "stdout": data["stdout"],
                    "stderr": data["stderr"],
                },
                TIME: now().isoformat(),
            })
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

    @XBlock.handler
    def download_pdf(self, data, suffix=""):
        """Generate and download the pdf summary of the exercise."""
        if not self.pdf_download_allowed:
            return Response(
                json.dumps({"error": "PDF download is disabled."}),
                status_code=400,
                content_type="application/json",
                charset="utf-8"
            )

        session = self.sessions[-1]

        if not session[USER_RESPONSE] or not session[CODE_EXEC_RESULT] or not session[AI_EVALUATION]:
            return Response(
                json.dumps({"error": "Data not available to generate transcript."}),
                status_code=400,
                content_type="application/json",
                charset="utf-8"
            )

        code = session[USER_RESPONSE]
        language_id = SUPPORTED_LANGUAGE_MAP[self.language].monaco_id
        lexer = get_lexer_by_name(language_id)
        # https://pygments.org/docs/formatters/#HtmlFormatter
        formatter = HtmlFormatter(
            # Line numbers are difficult here.
            # 'inline' breaks code copy/paste, and 'table' doesn't line up properly.
            # None play well with line wrapping.
            linenos=False,
            style='xcode',  # https://pygments.org/styles/
            noclasses=True,  # inline styles so we don't need to mess with external stylesheets
            wrapcode=True,  # use html5 semantic code elements
            nobackground=True,  # don't add a background; we want to control the background with our own css
            # override default inline styling; it sets it to 125% line-height automatically
            prestyles='line-height: 1.5em !important;',
        )

        # TODO: Currently the html/css output is not rendered, to avoid security issues.
        # We need to figure out how to safely handle output for html/css problems
        # (the output doesn't come from judge0; the output should be simply the rendered html/css).
        # This will require some extra security/privacy considerations.

        content = CodingData(
            code=CodingCode(
                language=self.language,
                highlighted_code=highlight(code, lexer, formatter),
                stdout=session[CODE_EXEC_RESULT]['stdout'],
                stderr=session[CODE_EXEC_RESULT]['stderr'],
            ),
            feedback=session[AI_EVALUATION],
            time=session.get(TIME)
        )
        return self.build_pdf_response(content)
