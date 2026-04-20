import logging
from typing import Literal, Any, Annotated
from datetime import datetime, UTC
from importlib.resources import files

import mistune
import nh3
from weasyprint import HTML, CSS
from jinja2 import Environment, FileSystemLoader
from pydantic import BaseModel, ConfigDict, Field, AfterValidator

# Quick reference docs:
# - https://doc.courtbouillon.org/weasyprint/stable/
# - https://pydantic.dev/docs/
# - https://jinja.palletsprojects.com/en/stable/


def pretty_time(value: datetime) -> str:
    """
    Jinja filter to get a human readable date with a consistent format.

    This is used to display date values in the PDFs.
    """
    # See https://docs.python.org/3/library/datetime.html#strftime-and-strptime-format-codes for formatting help.
    return value.strftime("%d %B %Y, %I:%M%p %Z")


# A shared jinja environment for consistency and potentially caching.
_JINJA_ENV = Environment(
    loader=FileSystemLoader(files("ai_eval").joinpath("static/pdf/templates")),
    autoescape=True,
    auto_reload=True,
)
_JINJA_ENV.filters["pretty_time"] = pretty_time


# XXX: The frontend uses dompurify and marked frontend/src/shared/renderMarkdown.ts;
# we may wish to consolidate markdown rendering and html cleaning to the backend, and remove it from the frontend.
def _markdown_to_safe_html(markdown_content: str) -> str:
    html_content = mistune.html(markdown_content)
    # docs: https://nh3.readthedocs.io/en/latest/
    # Disable links and images, to avoid privacy or security issues (eg. malicious links, large images causing a DOS attack).
    return nh3.clean(html_content, tags=nh3.ALLOWED_TAGS-{'a', 'img'})


class Info(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    title: str


class Student(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    email: str
    name: str


class Branding(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    logo: str


class Location(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    course_name: str
    course_url: str
    section_name: str
    section_url: str
    subsection_name: str
    subsection_url: str
    unit_name: str
    unit_url: str


class CoachedMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    kind: Literal["workspace"] | Literal["coach"] | Literal["student"]
    avatar_url: str
    name: str
    # NOTE: The time field on messages was added in 2026-04, so some existing instances may not have this field.
    # Use an optional field here to avoid breaking changes.
    # Also, the initial messages are hardcoded and don't really have a well defined timestamp (perhaps they could default to the course start date?).
    # TODO: check if this is actually used in production anywhere; we may still be able to make the breaking changes.
    time: datetime | None
    content: Annotated[str, AfterValidator(_markdown_to_safe_html)]


class CoachedSection(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    kind: Literal["workspace"] | Literal["coach"]
    messages: list[CoachedMessage]


class CoachedData(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    final_submission: Annotated[str, AfterValidator(_markdown_to_safe_html)]
    final_evaluation: Annotated[str, AfterValidator(_markdown_to_safe_html)]
    evaluator_name: str
    # This is a sectioned list of messages.
    # The sectioning is because there are two chat windows (student + coach, student + evaluator),
    # and we wanted the messages to be ordered by time, but still visually separated into the two chats.
    sections: list[CoachedSection]

    @staticmethod
    def template_file() -> str:
        return "coach.html"


class ShortAnswerMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    kind: Literal["llm"] | Literal["student"]
    avatar_url: str
    name: str
    # NOTE: The time field on messages was added in 2026-04, so some existing instances may not have this field.
    # Use an optional field here to avoid breaking changes.
    # TODO: check if this is actually used in production anywhere; we may still be able to make the breaking changes.
    time: datetime | None
    content: Annotated[str, AfterValidator(_markdown_to_safe_html)]


class ShortAnswerData(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    messages: list[ShortAnswerMessage]

    @staticmethod
    def template_file() -> str:
        return "shortanswer.html"


class CodingCode(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    language: str
    highlighted_code: str  # expected to be safe html, eg. as the result of a code highlighter
    stdout: str
    stderr: str


class CodingData(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    code: CodingCode
    feedback: Annotated[str, AfterValidator(_markdown_to_safe_html)]

    @staticmethod
    def template_file() -> str:
        return "coding.html"


# This data is the same for all templates; it does not include the actual content (chat messages, etc.)
class Metadata(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)
    info: Info
    student: Student
    branding: Branding
    location: Location | None  # location isn't available in some contexts, so we should gracefully handle this


def generate_pdf(metadata: Metadata, data: CoachedData | ShortAnswerData | CodingData) -> bytes:
    html = _JINJA_ENV.get_template(data.template_file()).render(
        data=data.model_dump(), time=datetime.now(UTC), **metadata.model_dump()
    )

    css = files("ai_eval").joinpath("static/pdf/base.css").read_text(encoding="utf8")

    # See https://doc.courtbouillon.org/weasyprint/stable/first_steps.html#security for security considerations here.
    # Any user-provided html must be sanitized with _markdown_to_safe_html()
    # which should avoid attacks involved malicious html, malicious inline css,
    # unexpected network requests for external resources, or leaking local files.
    # XXX: There is a known issue where fontTools (used by Weasyprint) log calls spams the logs with invalid formatting errors.
    #      This is annoying but seemingly harmless.
    #      It is related to the custom log format used by openedx-platform.
    return HTML(string=html).write_pdf(
        # we can put css in a separate file, or include it in a <style> element in the template html
        stylesheets=[CSS(string=css)],
        pdf_variant="pdf/a-3a",  # archival and accessible standard - see https://pdf.abbyy.com/learning-center/pdf-standards/ for comparison
        pdf_tags=True,  # a11y
    )
