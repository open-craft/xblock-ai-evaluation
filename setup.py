"""Setup for shortanswer XBlock."""

import os

from setuptools import setup


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
    version="0.1",
    description="XBlocks to write short text and code entries with AI-driven evaluation",
    license="Apache 2.0",
    packages=[
        "ai_eval",
    ],
    install_requires=[
        "XBlock",
        "litellm>=1.42",
    ],
    entry_points={
        "xblock.v1": [
            "shortanswer_ai_eval = ai_eval:ShortAnswerAIEvalXBlock",
            "coding_ai_eval = ai_eval:CodingAIEvalXBlock",
        ]
    },
    package_data=package_data("ai_eval", ["static", "public", "templates"]),
)
