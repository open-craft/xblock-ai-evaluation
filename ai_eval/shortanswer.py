"""Short answers Xblock with AI evaluation."""

import logging
import hashlib
import urllib.parse
import urllib.request
from multiprocessing.dummy import Pool
from xml.sax import saxutils

import chardet

from django.utils.translation import gettext_noop as _
from web_fragments.fragment import Fragment
from xblock.core import XBlock
from xblock.exceptions import JsonHandlerError
from xblock.fields import Boolean, Dict, Integer, List, String, Scope
from xblock.utils.studio_editable import FutureFields

from .base import AIEvalXBlock
from .llm import get_llm_service
from .llm_services import CustomLLMService, TIMEOUT_ERROR_MESSAGE


logger = logging.getLogger(__name__)


class ShortAnswerAIEvalXBlock(AIEvalXBlock):
    """
    Short Answer Xblock.
    """

    ATTACHMENT_PARALLEL_DOWNLOADS = 5

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

    attachment_urls = List(
        display_name=_("Attachment URLs"),
        help=_("Attachments to include with the evaluation prompt"),
        scope=Scope.settings,
        resettable_editor=False,
    )

    # XXX: Deprecated.
    messages = Dict(
        scope=Scope.user_state,
    )

    sessions = List(
        scope=Scope.user_state,
        default=[[]],
    )

    editable_fields = AIEvalXBlock.editable_fields + (
        "question",
        "evaluation_prompt",
        "max_responses",
        "allow_reset",
        "character_image",
        "attachment_urls",
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.messages:
            for user_msg, assistant_msg in zip(self.messages["USER"],
                                               self.messages["LLM"]):
                self.sessions[-1].append({
                    "source": "user",
                    "content": user_msg or ".",
                })
                self.sessions[-1].append({
                    "source": "llm",
                    "content": assistant_msg,
                })
            self.messages = {}
            self.save()

    def validate_field_data(self, validation, data):
        """
        Validate fields
        """
        validation_errors, validation_warnings = self._collect_studio_validation_issues(data)

        self._apply_studio_issues(
            validation,
            validation_errors,
            validation_warnings,
        )

        self._clear_cached_studio_warnings()

    def _collect_studio_validation_issues(
        self,
        data,
    ) -> tuple[dict[str, list[str]], list[str]]:
        """
        Extend base Studio validation issues with Short Answer field rules.
        """
        validation_errors, validation_warnings = super()._collect_studio_validation_issues(data)

        if not data.question:
            self._add_studio_validation_error(
                validation_errors,
                "question",
                _("Question field is mandatory"),
            )

        if not data.max_responses or data.max_responses <= 0 or data.max_responses > 15:
            self._add_studio_validation_error(
                validation_errors,
                "max_responses",
                _("max responses must be an integer between 1 and 15"),
            )

        try:
            self._get_attachments(data.attachment_urls)
        except Exception:  # pylint: disable=broad-exception-caught
            self._add_studio_validation_error(
                validation_errors,
                "attachment_urls",
                _("Error downloading attachments"),
            )

        return validation_errors, validation_warnings

    def student_view(self, context=None):
        """
        The primary view of the ShortAnswerAIEvalXBlock, shown to students
        when viewing courses.
        """
        frag = Fragment('<div data-ai-eval-react-root="true"></div>')

        frag.add_css_url(self._static_url("static/bundles/shared.css"))
        frag.add_css(self.resource_string("static/css/chatbox.css"))
        frag.add_javascript(self.resource_string("static/bundles/shortanswer.js"))

        js_data = self._build_view_payload(
            view="student",
            handler_urls={
                "get_response": self._handler_url("get_response"),
                "reset": self._handler_url("reset"),
            },
            initial_state={
                "messages": list(self.sessions[-1]),
            },
            meta={
                "question": self.question,
                "max_responses": self.max_responses,
                "allow_reset": self.allow_reset,
                "character_image": self.character_image,
            },
        )
        frag.initialize_js("ShortAnswerAIEvalXBlock", js_data)
        return frag

    def studio_view(self, context=None):
        """
        Render the Studio editor for Short Answer.
        """
        fragment = Fragment('<div data-ai-eval-react-root="true"></div>')
        fragment.add_css_url(self._static_url("static/bundles/shared.css"))
        fragment.add_css(self.resource_string("static/css/studio_api_key_lock.css"))
        fragment.add_css(self.resource_string("static/css/shortanswer_studio.css"))
        fragment.add_javascript(self.resource_string("static/bundles/shortanswer.studio.js"))
        fragment.initialize_js(
            "ShortAnswerAIEvalXBlockStudio",
            self._build_view_payload(
                view="studio",
                handler_urls={
                    "studio_submit": self._handler_url("studio_submit"),
                },
                initial_state=self._studio_initial_state(),
                meta=self._studio_payload_meta(),
            ),
        )
        return fragment

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

    def _download_attachment(self, url):
        with urllib.request.urlopen(url) as f:
            data = f.read()
            encoding = chardet.detect(data)['encoding']
            return data.decode(encoding)

    def _filename_for_url(self, url):
        return urllib.parse.urlparse(url).path.split('/')[-1]

    def _get_attachments(self, attachment_urls):
        with Pool(self.ATTACHMENT_PARALLEL_DOWNLOADS) as pool:
            attachments = pool.map(self._download_attachment, attachment_urls)
            filenames = map(self._filename_for_url, attachment_urls)
            return list(zip(filenames, attachments))

    @XBlock.json_handler
    def get_response(self, data, suffix=""):  # pylint: disable=unused-argument
        """Get LLM feedback"""
        user_submission = str(data["user_input"])

        attachments = []
        attachment_hash_inputs = []
        for filename, contents in self._get_attachments(self.attachment_urls):
            # Build system prompt attachment section (HTML-like) as before
            attachments.append(f"""
                <attachment>
                    <filename>{saxutils.escape(filename)}</filename>
                    <contents>{saxutils.escape(contents)}</contents>
                </attachment>
            """)
            # For tagging, hash filename + contents
            attachment_hash_inputs.append(f"{filename}|{contents}")
        attachments = '\n'.join(attachments)

        # Compute a tag to identify compatible reuse across provider/model/prompt
        # Include evaluation prompt, question, and attachment content hashes
        prompt_hasher = hashlib.sha256()
        prompt_hasher.update((self.evaluation_prompt or "").strip().encode("utf-8"))
        prompt_hasher.update((self.question or "").strip().encode("utf-8"))
        for item in attachment_hash_inputs:
            prompt_hasher.update(item.encode("utf-8"))
        prompt_hash = prompt_hasher.hexdigest()

        # Determine provider tag based on service type
        llm_service = get_llm_service()
        provider_tag = "custom" if isinstance(llm_service, CustomLLMService) else "default"
        current_tag = f"{provider_tag}:{self.model}:{prompt_hash}"

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
        for message in self.sessions[-1]:
            if message["source"] == "user":
                role = "user"
            else:
                role = "assistant"
            messages.append({
                "role": role,
                "content": message["content"] or ".",
            })
        messages.append({"role": "user", "content": user_submission})

        try:
            response = self.get_llm_response(messages, tag=current_tag)
        except Exception as e:
            logger.error(
                f"Failed while making LLM request using model {self.model}. Error: {e}",
                exc_info=True,
            )
            if str(e) == TIMEOUT_ERROR_MESSAGE:
                raise JsonHandlerError(500, str(e)) from e
            raise JsonHandlerError(500, "A probem occurred. Please retry.") from e

        if response:
            self._replace_current_session(self.sessions[-1] + [
                {"source": "user", "content": user_submission},
                {"source": "llm", "content": response},
            ])
            return {"response": response}

        raise JsonHandlerError(500, "A probem occurred. The LLM sent an empty response.")

    @XBlock.json_handler
    def reset(self, data, suffix=""):
        """
        Reset the Xblock.
        """
        if not self.allow_reset:
            raise JsonHandlerError(403, "Reset is disabled.")
        self.thread_map = {}
        self.sessions.append([])
        return {}

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
