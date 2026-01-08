## Introduction

This repository hosts several Open edX XBlocks, including:

1. **Short Answer with AI Evaluation**: This XBlock allows students to submit short answers, which are then evaluated with the help of a large language model (LLM).
2. **Coding with AI Evaluation**: This XBlock allows students to submit code in a text editor. The code is executed via a third-party API (currently using [Judge0](https://judge0.com/)), and both the code and its output are sent to an LLM for feedback.
3. **AI Eval Export (staff tool)**: This XBlock allows course staff to export learner conversations/sessions from supported AI Eval XBlocks as a CSV.

## Screeshots

| ![Short Answer with AI evaluation Xblock](docs/shortanswer-xblock.png) | ![Coding with AI evaluation Xblock](docs/coding-xblock.png) |
|-----------------------------------------------------------------------|----------------------------------------------------------------|
| ![Coding with AI evaluation Xblock HTML](docs/coding-xblock-ai-feedback.png) | ![Coding with AI evaluation Xblock AI feedback](docs/coding-xblock-html.png) |



## Setup

### Using Tutor

1. Add the following line to the `OPENEDX_EXTRA_PIP_REQUIREMENTS` in your Tutor `config.yml` file:
   ```yaml
   OPENEDX_EXTRA_PIP_REQUIREMENTS:
     - git+https://github.com/open-craft/xblock-ai-evaluation
   ```
   You can append  `@vX.Y.Z` to the URL to specify your desired version.

2. Launch Tutor.

3. In the Open edX platform, navigate to `Settings > Advanced Settings` and add `shortanswer_ai_eval` and `coding_ai_eval` to the `Advanced Module List`. If you want the export tool, also add `ai_eval_export`.

4. Add either XBlock using the `Advanced` button in the `Add New Component` section of Studio.

5. Configure the added Xblock and make sure to add correct API keys. You can format your question and prompts using [Markdown](https://marked.js.org/demo/).

### Export Tool (ai_eval_export)

The `ai_eval_export` XBlock is a preconfigured, staff-only tool for exporting learner conversation/session history from supported AI Eval XBlocks in a course.

- Enable it by adding `ai_eval_export` to the course `Advanced Module List`, then add it to a unit via the Studio “Advanced” component picker.
- It only works from the LMS (Studio/CMS uses different Celery queues), and it only renders for course staff.
- Clicking “Start export” generates a CSV and provides a download link when ready.
- The CSV includes a `Course Name` column (human-readable course title) and includes `Location` to identify the specific XBlock usage within the course.

### API Configuration

The XBlocks support multiple ways to configure API keys and URLs for language models.  
The system will check for these configurations in the following order:
1. **XBlock-level configuration**: API keys and URLs can be set directly in each XBlock instance through the Studio UI.
2. **Site configuration**: Values can be set globally for all XBlocks using Open edX's Site Configuration.
   To configure values in Site Configuration, navigate to `Django admin > Site Configurations` and add the following keys:
   ```json
    {
        "ai_eval": {
             "GPT4O_API_KEY": "your-openai-api-key",
             "LLAMA_API_URL": "https://your-llama-endpoint"
        }
    }
    ```
3. **Django settings**: Values can be defined in the Django settings. 
   To configure in Django settings (e.g., in Tutor), add the following to your configuration:
   ```python
   XBLOCK_SETTINGS = {
       "ai_eval": {
           "GPT4O_API_KEY": "your-openai-api-key",
           "LLAMA_API_URL": "https://your-llama-endpoint"
        }
    }
    ```

#### Note About API URLs

API URLs are only required and used with the LLAMA model (`ollama/llama2`). Other models use their standard endpoints and only require API keys.

#### Security Considerations

For better security, we recommend using site configuration or Django settings instead of configuring API keys at the 
XBlock level. This prevents API keys from being exposed in course exports.

### Custom LLM Service (advanced)

The XBlocks can optionally route all LLM interactions through a custom LLM service instead of the default provider.
To enable a custom service, configure the following **Site Configuration** keys under the `ai_eval` namespace:

```json
{
  "ai_eval": {
    "USE_CUSTOM_LLM_SERVICE": true,
    "CUSTOM_LLM_MODELS_URL": "https://your-custom-service/models",
    "CUSTOM_LLM_COMPLETIONS_URL": "https://your-custom-service/completions",
    "CUSTOM_LLM_TOKEN_URL": "https://your-custom-service/oauth/token"
  }
}
```

Additionally, set your client credentials in Django settings (e.g. via Tutor config):

```python
CUSTOM_LLM_CLIENT_ID = "your-client-id"
CUSTOM_LLM_CLIENT_SECRET = "your-client-secret"
```

Your custom service must implement the expected OAuth2 client‑credentials flow and provide JSON endpoints
for listing models, obtaining completions, and fetching tokens as used by `CustomLLMService`.

#### Optional provider threads (conversation IDs)

For deployments using a custom LLM service, you can enable provider‑side threads to cache context between turns. This is optional and disabled by default. When enabled, the LMS/XBlock remains the canonical chat history as that ensures vendor flexibility and continuity; provider threads are treated as a cache.

- Site configuration (under `ai_eval`):
  - `PROVIDER_SUPPORTS_THREADS`: boolean, default `false`. When `true`, `CustomLLMService` attempts to reuse a provider conversation ID.
- XBlock user state (managed automatically):
  - `thread_map`: a dictionary mapping `tag -> conversation_id`, where `tag = provider:model:prompt_hash`. This allows multiple concurrent provider threads per learner per XBlock, one per distinct prompt/model context.

Reset clears `thread_map`. If a provider ignores threads, behavior remains stateless.

Compatibility and fallback
- Not all vendors/models support `conversation_id`. The default service path (via LiteLLM chat completions) does not use provider threads; calls remain stateless.
- If threads are unsupported or ignored by a provider, the code still works and behaves statelessly.
- With a custom provider that supports threads, the first turn sends full context and later turns send only the latest user input along with the cached `conversation_id`.

### Custom Code Execution Service (advanced)

The Coding XBlock can route code execution to a third‑party service instead of Judge0. The service is expected to be asynchronous, exposing a submit endpoint that returns a submission identifier, and a results endpoint that returns the execution result when available. Configure this via Django settings:

```python
# e.g., in Tutor's extra settings
AI_EVAL_CODE_EXECUTION_BACKEND = {
    'backend': 'custom',
    'custom_config': {
        'submit_endpoint': 'https://code-exec.example.com/api/submit',
        'results_endpoint': 'https://code-exec.example.com/api/results/{submission_id}',
        'languages_endpoint': 'https://code-exec.example.com/api/languages',
        'api_key': 'example-key',
        # For Bearer tokens (default): Authorization: Bearer <token>
        'auth_header_name': 'Authorization',
        'auth_scheme': 'Bearer',
        # Networking
        'timeout': 30,
    },
}
```

Header examples
- Bearer (default): `Authorization: Bearer <API_KEY>` (use `auth_header_name='Authorization'`, `auth_scheme='Bearer'`)
- Vendor header without scheme: `X-API-Key: <API_KEY>` (use `auth_header_name='X-API-Key'`, `auth_scheme=''`)

Notes
- Asynchronous model: `submit_endpoint` should return an identifier (e.g., `submission_id` or `id`) that is later used to poll `results_endpoint`.
- `results_endpoint` must include `{submission_id}` and return execution status and outputs when ready.
- `languages_endpoint` is called during initialization to verify supported languages.
- To use Judge0, remove the custom backend settings or set `backend='judge0'`. Provide the Judge0 API key in the XBlock configuration. Optionally set `judge0_config.base_url`; otherwise the default RapidAPI endpoint is used.

Example Judge0 configuration
```python
# Optional override for Judge0 base URL; API key is set per XBlock instance
AI_EVAL_CODE_EXECUTION_BACKEND = {
    'backend': 'judge0',
    'judge0_config': {
        'base_url': 'https://judge0-ce.p.rapidapi.com',
    },
}
```

## Dependencies
- [Judge0 API](https://judge0.com/)
- [Monaco editor](https://github.com/microsoft/monaco-editor)
- [LiteLLM](https://github.com/BerriAI/litellm)
