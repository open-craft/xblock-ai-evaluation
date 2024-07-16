## Introduction

This repository hosts two Open edX XBlocks: 

1. **Short Answer with AI Evaluation**: This XBlock allows students to submit short answers, which are then evaluated with the help of a large language model (LLM).
2. **Coding with AI Evaluation**: This XBlock allows students to submit code in a text editor. The code is executed via a third-party API (currently using [Judge0](https://judge0.com/)), and both the code and its output are sent to an LLM for feedback.

![Coding with AI evaluation Xblock](docs/coding-xblock.png)

## Setup

### Using Tutor

1. Add the following line to the `OPENEDX_EXTRA_PIP_REQUIREMENTS` in your Tutor `config.yml` file:
   ```yaml
   OPENEDX_EXTRA_PIP_REQUIREMENTS:
     - git+https://github.com/open-craft/xblock-ai-evaluation
   ```
   You can append  `@vX.Y.Z` to the URL to specify your desired version.

2. Launch Tutor.

3. In the Open edX platform, navigate to `Settings > Advanced Settings` and add `shortanswer_ai_eval` and `coding_ai_eval` to the `Advanced Module List`.

4. Add either XBlock using the `Advanced` button in the `Add New Component` section of Studio.

5. Configure the added Xblock and make sure to add correct API keys. You can format your question and prompts using [Markdown](https://marked.js.org/demo/).

## Dependencies
- [Judge0 API](https://judge0.com/)
- [Monaco editor](https://github.com/microsoft/monaco-editor)
- [LiteLLM](https://github.com/BerriAI/litellm)