"""Short answers Xblock with AI evaluation."""

import json
import logging
import traceback
from xml.sax import saxutils

from django.utils.translation import gettext_noop as _
from web_fragments.fragment import Fragment
from webob import Response
from webob.exc import HTTPForbidden, HTTPNotFound
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Boolean, Dict, Integer, String, Scope
from xblock.validation import ValidationMessage

from .base import AIEvalXBlock


logger = logging.getLogger(__name__)


@XBlock.wants('studio_user_permissions')
class ShortAnswerAIEvalXBlock(AIEvalXBlock):
    """
    Short Answer Xblock.
    """

    USER_KEY = "USER"
    LLM_KEY = "LLM"

    display_name = String(
        display_name=_("Display Name"),
        help=_("Name of the component in the studio"),
        default="Short answer with AI Evaluation",
        scope=Scope.settings,
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

    character_image = String(
        display_name=_("Character Image URL"),
        help=_(
            "URL for an image to be shown to the left of the chat box; "
            "leave empty to disable"
        ),
        scope=Scope.settings,
    )

    max_responses = Integer(
        display_name=_("Max Responses"),
        help=_("The maximum number of response messages the student can submit"),
        scope=Scope.settings,
        default=3,
    )

    allow_reset = Boolean(
        display_name=_("Allow reset"),
        help=_("Allow the learner to reset the chat"),
        scope=Scope.settings,
        default=False,
    )

    attachments = Dict(
        display_name=_("Attachments"),
        help=_("Attachments to include with the evaluation prompt"),
        scope=Scope.settings,
        resettable_editor=False,
    )

    messages = Dict(
        help=_("Dictionary with chat messages"),
        scope=Scope.user_state,
        default={USER_KEY: [], LLM_KEY: []},
    )

    editable_fields = AIEvalXBlock.editable_fields + (
        "question",
        "evaluation_prompt",
        "max_responses",
        "allow_reset",
        "character_image",
        "attachments",
    )

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
                "/templates/chatbox.html",
                {
                    "self": self,
                    "has_finish_button": False,
                    "question_text": _("Loading..."),
                },
            )
        )

        frag.add_css(self.resource_string("static/css/chatbox.css"))
        frag.add_javascript(self.resource_string("static/js/src/utils.js"))
        frag.add_javascript(self.resource_string("static/js/src/chatbox.js"))
        frag.add_javascript(self.resource_string("static/js/src/shortanswer.js"))

        marked_html = self.resource_string("static/html/marked-iframe.html")

        js_data = {
            "question": self.question,
            "messages": self.messages,
            "max_responses": self.max_responses,
            "marked_html": marked_html,
        }
        frag.initialize_js("ShortAnswerAIEvalXBlock", js_data)
        return frag

    @XBlock.json_handler
    def get_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Get LLM feedback"""
        user_submission = str(data["user_input"])

        attachments = []
        for filename, contents in self.attachments.items():
            attachments.append(f"""
                <attachment>
                    <filename>{saxutils.escape(filename)}</filename>
                    <contents>{saxutils.escape(contents)}</contents>
                </attachment>
            """)
        attachments = '\n'.join(attachments)

        system_msg = {
            "role": "system",
            "content": f"""
                {self.evaluation_prompt}

                {attachments}

                {self.question}.

                Evaluation must be in Markdown format.
            """,
        }
        messages = [system_msg]
        # add previous messages
        # the first AI role is 'system' which defines the LLM's personnality and behavior.
        # subsequent roles are 'assistant' and 'user'
        for user_msg, assistant_msg in zip(self.messages[self.USER_KEY],
                                           self.messages[self.LLM_KEY]):
            messages.append({"content": user_msg or ".", "role": "user"})
            messages.append({"content": assistant_msg, "role": "assistant"})
        messages.append({"role": "user", "content": user_submission})

        try:
            response = self.get_llm_response(messages)
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

    @XBlock.json_handler
    def reset(self, data, suffix=""):
        """
        Reset the Xblock.
        """
        if not self.allow_reset:
            raise JsonHandlerError(403, "Reset is disabled.")
        self.messages = {self.USER_KEY: [], self.LLM_KEY: []}
        return {}

    def studio_view(self, context):
        """
        Render a form for editing this XBlock
        """
        fragment = super().studio_view(context)
        fragment.add_javascript(self.resource_string("static/js/src/shortanswer_edit.js"))
        # ShortAnswerAIEvalXBlock() in base.js will call StudioEditableXBlockMixin().
        fragment.initialize_js("ShortAnswerAIEvalXBlock")
        return fragment

    # Optimisation: don't send file contents to the edit view,
    # and use null value as flag to keep same contents.

    def _make_field_info(self, field_name, field):
        info = super()._make_field_info(field_name, field)
        if field_name == "attachments":
            info["value"] = json.dumps(
                {f: None for f in field.read_from(self).keys()}
            )
        return info

    @XBlock.json_handler
    def submit_studio_edits(self, data, suffix=''):
        if "attachments" in data["values"]:
            for key, value in list(data["values"]["attachments"].items()):
                if value is None:
                    data["values"]["attachments"][key] = self.attachments[key]
        return super().submit_studio_edits.__wrapped__(self, data, suffix)

    @XBlock.handler
    def view_attachment(self, request, suffix=''):
        """
        Download an attachment.
        """
        user_perms = self.runtime.service(self, 'studio_user_permissions')
        if not (user_perms and user_perms.can_read(self.scope_ids.usage_id.context_key)):
            return request.get_response(HTTPForbidden())

        key = request.GET['key']
        try:
            data = self.attachments[key]
        except KeyError:
            return request.get_response(HTTPNotFound())

        escaped = key.replace("\\", "\\\\").replace('"', '\\"')
        return Response(
            body=data.encode(),
            headerlist=[
                ("Content-Type", "application/octet-stream"),
                ("Content-Disposition", f'attachment; filename="{escaped}"'),
            ]
        )

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
