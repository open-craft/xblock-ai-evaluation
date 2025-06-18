## Introduction

This repository hosts two Open edX XBlocks: 

1. **Short Answer with AI Evaluation**: This XBlock allows students to submit short answers, which are then evaluated with the help of a large language model (LLM).
2. **Coding with AI Evaluation**: This XBlock allows students to submit code in a text editor. The code is executed via a third-party API (currently using [Judge0](https://judge0.com/)), and both the code and its output are sent to an LLM for feedback.

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

3. In the Open edX platform, navigate to `Settings > Advanced Settings` and add `shortanswer_ai_eval` and `coding_ai_eval` to the `Advanced Module List`.

4. Add either XBlock using the `Advanced` button in the `Add New Component` section of Studio.

5. Configure the added Xblock and make sure to add correct API keys. You can format your question and prompts using [Markdown](https://marked.js.org/demo/).

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

## Dependencies
- [Judge0 API](https://judge0.com/)
- [Monaco editor](https://github.com/microsoft/monaco-editor)
- [LiteLLM](https://github.com/BerriAI/litellm)
