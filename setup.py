"""Setup for shortanswer XBlock."""

import os

from setuptools import setup, find_packages


def package_data(pkg, roots):
    """Generic function to find package_data.

    All of the files under each of the `roots` will be declared as package
    data for package `pkg`.

    """
    data = []
    for root in roots:
        for dirname, _, files in os.walk(os.path.join(pkg, root)):
            for fname in files:
                data.append(os.path.relpath(os.path.join(dirname, fname), pkg))

    return {pkg: data}


setup(
    name="xblock-ai-eval",
    version="0.3.0",
    description="XBlocks to write short text and code entries with AI-driven evaluation",
    license="Apache 2.0",
    packages=find_packages(
        include=["ai_eval", "ai_eval.*"],
        exclude=["*tests"],
    ),
    install_requires=[
        "XBlock",
        "celery",
        "chardet",
        "litellm",
    ],
    entry_points={
        "xblock.v1": [
            "ai_eval_export = ai_eval:DataExportXBlock",
            "shortanswer_ai_eval = ai_eval:ShortAnswerAIEvalXBlock",
            "coding_ai_eval = ai_eval:CodingAIEvalXBlock",
            "multiagent_ai_eval = ai_eval:MultiAgentAIEvalXBlock",
            "coach_ai_eval = ai_eval:CoachAIEvalXBlock",
        ]
    },
    package_data=package_data("ai_eval", ["static", "public", "templates"]),
    python_requires=">=3.11",
)
