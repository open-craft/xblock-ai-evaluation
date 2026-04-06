import React, { useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Form } from "@openedx/paragon";
import { RequestError } from "../shared/request";
import { FieldErrors, FieldHelp } from "../shared/StudioFormFields";
import { StudioValidationSummary } from "../shared/StudioValidationSummary";
import {
  getSaveErrorMessage,
  isModelApiKeyLocked,
  normalizeStudioSaveResponse,
  normalizeValidationErrors,
  normalizeValidationWarnings,
  notifyRuntime,
  StudioSaveResponse,
  submitStudioPayload,
  ValidationErrors,
} from "../shared/studio";
import { StudioFieldMetadata, XBlockRuntime } from "../shared/types";
import {
  CodingStudioLockMetadata,
  CodingStudioMeta,
  CodingStudioPayload,
  CodingStudioState,
} from "./types";

function normalizeInitialState(initialState: CodingStudioState): CodingStudioState {
  return {
    display_name: typeof initialState.display_name === "string" ? initialState.display_name : "",
    model: typeof initialState.model === "string" ? initialState.model : "",
    model_api_key:
      typeof initialState.model_api_key === "string" ? initialState.model_api_key : "",
    model_api_url:
      typeof initialState.model_api_url === "string" ? initialState.model_api_url : "",
    question: typeof initialState.question === "string" ? initialState.question : "",
    evaluation_prompt:
      typeof initialState.evaluation_prompt === "string"
        ? initialState.evaluation_prompt
        : "",
    judge0_api_key:
      typeof initialState.judge0_api_key === "string" ? initialState.judge0_api_key : "",
    language: typeof initialState.language === "string" ? initialState.language : "",
  };
}

function buildSubmitPayload(values: CodingStudioState) {
  return {
    display_name: values.display_name || "",
    model: values.model || "",
    model_api_key: values.model_api_key || "",
    model_api_url: values.model_api_url || "",
    question: values.question || "",
    evaluation_prompt: values.evaluation_prompt || "",
    judge0_api_key: values.judge0_api_key || "",
    language: values.language || "",
  };
}

function CodingSettingsForm({
  fieldMetadata,
  lockMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  lockMetadata?: CodingStudioLockMetadata;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: ValidationErrors;
  values: CodingStudioState;
}) {
  const modelApiKeyLocked = isModelApiKeyLocked(values, lockMetadata);
  const judge0Locked = Boolean(lockMetadata?.lock_judge0_api_key);
  const modelChoices = Array.isArray(fieldMetadata.model?.choices)
    ? fieldMetadata.model.choices
    : [];
  const languageChoices = Array.isArray(fieldMetadata.language?.choices)
    ? fieldMetadata.language.choices
    : [];

  return (
    <Form>
      <Form.Group controlId="xb-field-edit-display_name" isInvalid={Boolean(validationErrors.display_name)}>
        <Form.Label>{fieldMetadata.display_name?.display_name || "display_name"}</Form.Label>
        <Form.Control
          type="text"
          value={values.display_name || ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("display_name", event.target.value);
          }}
        />
        <FieldErrors errors={validationErrors.display_name} />
        <FieldHelp metadata={fieldMetadata.display_name} />
      </Form.Group>

      <Form.Group controlId="xb-field-edit-model" isInvalid={Boolean(validationErrors.model)}>
        <Form.Label>{fieldMetadata.model?.display_name || "model"}</Form.Label>
        <Form.Control
          as="select"
          value={values.model || ""}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            onChange("model", event.target.value);
          }}
        >
          {modelChoices.map((choice, index) => (
            <option key={String(index)} value={choice.value || ""}>
              {choice.display_name || choice.value || ""}
            </option>
          ))}
        </Form.Control>
        <FieldErrors errors={validationErrors.model} />
        <FieldHelp metadata={fieldMetadata.model} />
      </Form.Group>

      <Form.Group
        controlId="xb-field-edit-model_api_key"
        isInvalid={Boolean(validationErrors.model_api_key)}
        className={modelApiKeyLocked ? "ai-eval-locked-entry" : undefined}
      >
        <Form.Label>
          {fieldMetadata.model_api_key?.display_name || "model_api_key"}
          {modelApiKeyLocked ? <span className="ai-eval-lock-badge"> (Locked by admin)</span> : null}
        </Form.Label>
        <Form.Control
          type="text"
          disabled={modelApiKeyLocked}
          value={values.model_api_key || ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("model_api_key", event.target.value);
          }}
        />
        <FieldErrors errors={validationErrors.model_api_key} />
        <FieldHelp metadata={fieldMetadata.model_api_key} />
      </Form.Group>

      <Form.Group controlId="xb-field-edit-model_api_url" isInvalid={Boolean(validationErrors.model_api_url)}>
        <Form.Label>{fieldMetadata.model_api_url?.display_name || "model_api_url"}</Form.Label>
        <Form.Control
          type="text"
          value={values.model_api_url || ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("model_api_url", event.target.value);
          }}
        />
        <FieldErrors errors={validationErrors.model_api_url} />
        <FieldHelp metadata={fieldMetadata.model_api_url} />
      </Form.Group>

      <Form.Group controlId="xb-field-edit-question" isInvalid={Boolean(validationErrors.question)}>
        <Form.Label>{fieldMetadata.question?.display_name || "question"}</Form.Label>
        <Form.Control
          as="textarea"
          rows={10}
          value={values.question || ""}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange("question", event.target.value);
          }}
        />
        <FieldErrors errors={validationErrors.question} />
        <FieldHelp metadata={fieldMetadata.question} />
      </Form.Group>

      <Form.Group controlId="xb-field-edit-evaluation_prompt" isInvalid={Boolean(validationErrors.evaluation_prompt)}>
        <Form.Label>{fieldMetadata.evaluation_prompt?.display_name || "evaluation_prompt"}</Form.Label>
        <Form.Control
          as="textarea"
          rows={10}
          value={values.evaluation_prompt || ""}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange("evaluation_prompt", event.target.value);
          }}
        />
        <FieldErrors errors={validationErrors.evaluation_prompt} />
        <FieldHelp metadata={fieldMetadata.evaluation_prompt} />
      </Form.Group>

      <Form.Group
        controlId="xb-field-edit-judge0_api_key"
        isInvalid={Boolean(validationErrors.judge0_api_key)}
        className={judge0Locked ? "ai-eval-locked-entry" : undefined}
      >
        <Form.Label>
          {fieldMetadata.judge0_api_key?.display_name || "judge0_api_key"}
          {judge0Locked ? <span className="ai-eval-lock-badge"> (Locked by admin)</span> : null}
        </Form.Label>
        <Form.Control
          type="text"
          disabled={judge0Locked}
          value={values.judge0_api_key || ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("judge0_api_key", event.target.value);
          }}
        />
        <FieldErrors errors={validationErrors.judge0_api_key} />
        <FieldHelp metadata={fieldMetadata.judge0_api_key} />
      </Form.Group>

      <Form.Group controlId="xb-field-edit-language" isInvalid={Boolean(validationErrors.language)}>
        <Form.Label>{fieldMetadata.language?.display_name || "language"}</Form.Label>
        <Form.Control
          as="select"
          value={values.language || ""}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            onChange("language", event.target.value);
          }}
        >
          {languageChoices.map((choice, index) => (
            <option key={String(index)} value={choice.value || ""}>
              {choice.display_name || choice.value || ""}
            </option>
          ))}
        </Form.Control>
        <FieldErrors errors={validationErrors.language} />
        <FieldHelp metadata={fieldMetadata.language} />
      </Form.Group>
    </Form>
  );
}

export default function CodingStudioApp({
  payload,
  runtime,
}: {
  payload: CodingStudioPayload;
  runtime?: XBlockRuntime;
}) {
  const intl = useIntl();
  const initialValues = useMemo(() => {
    return normalizeInitialState(payload.initial_state);
  }, [payload.initial_state]);
  const [values, setValues] = useState(initialValues);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [requestError, setRequestError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const meta: CodingStudioMeta = payload.meta || {};
  const fieldMetadata = meta.field_metadata || {};
  const lockMetadata = meta.lock_metadata;

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  function handleSave(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();

    if (!payload.handler_urls.studio_submit || isSaving) {
      return;
    }

    const savingMessage = intl.formatMessage({
      id: "coding.studio.saving",
      defaultMessage: "Saving",
    });

    setIsSaving(true);
    setRequestError("");
    setValidationErrors({});
    setValidationWarnings([]);
    notifyRuntime(runtime, "save", {
      state: "start",
      message: savingMessage,
    });

    submitStudioPayload(payload.handler_urls.studio_submit, buildSubmitPayload(values))
      .then((response: StudioSaveResponse) => {
        setValidationErrors(normalizeValidationErrors(response.validation_errors));
        setValidationWarnings(normalizeValidationWarnings(response.validation_warnings));
        setIsSaving(false);

        if (response.success) {
          notifyRuntime(runtime, "save", { state: "end" });
        } else {
          notifyRuntime(runtime, "error", {
            title: intl.formatMessage({
              id: "coding.studio.saveFailed",
              defaultMessage: "Unable to update settings",
            }),
            message: intl.formatMessage({
              id: "coding.studio.validationError",
              defaultMessage: "Please fix the validation issues and try again.",
            }),
          });
        }
      })
      .catch((error: unknown) => {
        let inlineRequestError = "";

        if (error instanceof RequestError && error.payload) {
          const normalizedResponse = normalizeStudioSaveResponse(error.payload);
          setValidationErrors(normalizeValidationErrors(normalizedResponse.validation_errors));
          setValidationWarnings(normalizeValidationWarnings(normalizedResponse.validation_warnings));
          if (Object.keys(normalizedResponse.validation_errors).length > 0) {
            inlineRequestError = intl.formatMessage({
              id: "coding.studio.validationError",
              defaultMessage: "Please fix the validation issues and try again.",
            });
          }
        }

        if (!inlineRequestError) {
          inlineRequestError = getSaveErrorMessage(
            error,
            intl.formatMessage({
              id: "coding.studio.genericError",
              defaultMessage:
                "This may be happening because of an error with our server or your internet connection. Try refreshing the page or making sure you are online.",
            }),
          );
        }

        setRequestError(inlineRequestError);
        setIsSaving(false);
        notifyRuntime(runtime, "error", {
          title: intl.formatMessage({
            id: "coding.studio.saveFailed",
            defaultMessage: "Unable to update settings",
          }),
          message: inlineRequestError,
        });
      });
  }

  const hasFieldErrors = Object.keys(validationErrors).length > 0;

  return (
    <div
      className="editor-with-buttons shortanswer-react-studio coding-react-studio"
      data-block-kind="coding"
    >
      <div className="wrapper-comp-settings is-active editor-with-buttons" id="settings-tab">
        <StudioValidationSummary
          hasFieldErrors={hasFieldErrors}
          requestError={requestError}
          validationWarnings={validationWarnings}
        />
        <CodingSettingsForm
          fieldMetadata={fieldMetadata}
          lockMetadata={lockMetadata}
          validationErrors={validationErrors}
          values={values}
          onChange={(fieldName, nextValue) => {
            setValues((currentValues) => {
              return {
                ...currentValues,
                [fieldName]: nextValue,
              };
            });
          }}
        />
      </div>
      <div className="xblock-actions">
        <ul>
          <li className="action-item">
            <a
              href="#"
              className="button action-primary action-save shortanswer-studio-save-button"
              aria-disabled={isSaving}
              onClick={handleSave}
            >
              <span className="action-button-text">
                {isSaving
                  ? intl.formatMessage({
                      id: "coding.studio.savingButton",
                      defaultMessage: "Saving...",
                    })
                  : intl.formatMessage({
                      id: "coding.studio.save",
                      defaultMessage: "Save",
                    })}
              </span>
            </a>
          </li>
          <li className="action-item">
            <a
              href="#"
              className="button action-cancel shortanswer-studio-cancel-button"
              onClick={(event) => {
                event.preventDefault();
                notifyRuntime(runtime, "cancel", {});
              }}
            >
              <span className="action-button-text">
                {intl.formatMessage({
                  id: "coding.studio.cancel",
                  defaultMessage: "Cancel",
                })}
              </span>
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
