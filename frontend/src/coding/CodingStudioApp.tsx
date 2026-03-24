import React, { useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";

import { RequestError } from "../shared/request";
import {
  normalizeStudioSaveResponse,
  StudioSaveResponse,
  submitStudioPayload,
} from "../shared/studio";
import { UnknownRecord, XBlockRuntime } from "../shared/types";
import {
  CodingStudioLockMetadata,
  CodingStudioMeta,
  CodingStudioPayload,
  CodingStudioState,
  StudioFieldMetadata,
} from "./types";

type ValidationErrors = Record<string, string[]>;

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

function normalizeValidationWarnings(rawWarnings: unknown): string[] {
  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  return rawWarnings
    .filter((warning) => typeof warning === "string")
    .map((warning) => String(warning));
}

function normalizeValidationErrors(rawErrors: unknown): ValidationErrors {
  if (!rawErrors || typeof rawErrors !== "object") {
    return {};
  }

  const validationErrors = rawErrors as Record<string, unknown>;

  return Object.keys(validationErrors).reduce<ValidationErrors>((errors, fieldName) => {
    const fieldErrors = validationErrors[fieldName];

    if (Array.isArray(fieldErrors)) {
      errors[fieldName] = fieldErrors
        .filter((entry) => typeof entry === "string")
        .map((entry) => String(entry));
    } else if (typeof fieldErrors === "string" && fieldErrors) {
      errors[fieldName] = [fieldErrors];
    }

    return errors;
  }, {});
}

function getSaveErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof RequestError && error.payload) {
    const normalizedResponse = normalizeStudioSaveResponse(error.payload);
    const payloadHasIssues =
      Object.keys(normalizedResponse.validation_errors).length > 0 ||
      normalizedResponse.validation_warnings.length > 0;

    if (payloadHasIssues) {
      return error.message;
    }
  }

  if (error instanceof RequestError && error.message) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

function notifyRuntime(runtime: XBlockRuntime | undefined, name: string, payload?: UnknownRecord) {
  if (runtime && typeof runtime.notify === "function") {
    runtime.notify(name, payload);
  }
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

function isModelApiKeyLocked(values: CodingStudioState, lockMetadata?: CodingStudioLockMetadata) {
  if (lockMetadata?.use_custom_llm_service) {
    return true;
  }

  const modelName = values.model || lockMetadata?.initial_model || "";
  if (
    lockMetadata?.model_key_presence &&
    Object.prototype.hasOwnProperty.call(lockMetadata.model_key_presence, modelName)
  ) {
    return Boolean(lockMetadata.model_key_presence[modelName]);
  }

  return Boolean(lockMetadata?.lock_model_api_key_initial);
}

function FieldHelp({ metadata }: { metadata?: StudioFieldMetadata }) {
  if (!metadata?.help) {
    return null;
  }

  return <span className="tip setting-help">{metadata.help}</span>;
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) {
    return null;
  }

  return (
    <ul className="shortanswer-studio-errors">
      {errors.map((error, index) => {
        return <li key={String(index)}>{error}</li>;
      })}
    </ul>
  );
}

function StudioValidationSummary({
  requestError,
  validationWarnings,
}: {
  requestError: string;
  validationWarnings: string[];
}) {
  if (!requestError && validationWarnings.length === 0) {
    return null;
  }

  return (
    <div className="shortanswer-studio-summary">
      {requestError ? <div className="shortanswer-studio-summary__error">{requestError}</div> : null}
      {validationWarnings.length > 0 ? (
        <ul className="shortanswer-studio-summary__warnings">
          {validationWarnings.map((warning, index) => {
            return <li key={String(index)}>{warning}</li>;
          })}
        </ul>
      ) : null}
    </div>
  );
}

function TextField({
  errors,
  fieldName,
  locked,
  metadata,
  onChange,
  type,
  value,
}: {
  errors?: string[];
  fieldName: string;
  locked?: boolean;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: string) => void;
  type: string;
  value: string;
}) {
  return (
    <li
      className={
        "field comp-setting-entry metadata_entry" + (locked ? " ai-eval-locked-entry" : "")
      }
      data-field-name={fieldName}
    >
      <div className="wrapper-comp-setting">
        <label className="label setting-label" htmlFor={"xb-field-edit-" + fieldName}>
          {metadata?.display_name || fieldName}
          {locked ? <span className="ai-eval-lock-badge"> (Locked by admin)</span> : null}
        </label>
        <input
          id={"xb-field-edit-" + fieldName}
          type={type}
          className="field-data-control"
          disabled={Boolean(locked)}
          aria-disabled={Boolean(locked)}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </div>
      <FieldErrors errors={errors} />
      <FieldHelp metadata={metadata} />
    </li>
  );
}

function TextAreaField({
  errors,
  fieldName,
  metadata,
  onChange,
  value,
}: {
  errors?: string[];
  fieldName: string;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: string) => void;
  value: string;
}) {
  return (
    <li className="field comp-setting-entry metadata_entry" data-field-name={fieldName}>
      <div className="wrapper-comp-setting">
        <label className="label setting-label" htmlFor={"xb-field-edit-" + fieldName}>
          {metadata?.display_name || fieldName}
        </label>
        <textarea
          id={"xb-field-edit-" + fieldName}
          className="field-data-control"
          rows={10}
          cols={70}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </div>
      <FieldErrors errors={errors} />
      <FieldHelp metadata={metadata} />
    </li>
  );
}

function SelectField({
  errors,
  fieldName,
  metadata,
  onChange,
  value,
}: {
  errors?: string[];
  fieldName: string;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: string) => void;
  value: string;
}) {
  const choices = Array.isArray(metadata?.choices) ? metadata?.choices : [];

  return (
    <li className="field comp-setting-entry metadata_entry" data-field-name={fieldName}>
      <div className="wrapper-comp-setting">
        <label className="label setting-label" htmlFor={"xb-field-edit-" + fieldName}>
          {metadata?.display_name || fieldName}
        </label>
        <div className="shortanswer-studio-select-shell">
          <select
            id={"xb-field-edit-" + fieldName}
            className="field-data-control shortanswer-studio-select"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          >
            {choices.map((choice, index) => {
              return (
                <option key={String(index)} value={choice.value || ""}>
                  {choice.display_name || choice.value || ""}
                </option>
              );
            })}
          </select>
          <span className="shortanswer-studio-select-icon" aria-hidden="true">
            ▾
          </span>
        </div>
      </div>
      <FieldErrors errors={errors} />
      <FieldHelp metadata={metadata} />
    </li>
  );
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
  return (
    <ul className="list-input settings-list">
      <TextField
        fieldName="display_name"
        metadata={fieldMetadata.display_name}
        value={values.display_name || ""}
        errors={validationErrors.display_name}
        onChange={(nextValue) => {
          onChange("display_name", nextValue);
        }}
        type="text"
      />
      <SelectField
        fieldName="model"
        metadata={fieldMetadata.model}
        value={values.model || ""}
        errors={validationErrors.model}
        onChange={(nextValue) => {
          onChange("model", nextValue);
        }}
      />
      <TextField
        fieldName="model_api_key"
        metadata={fieldMetadata.model_api_key}
        value={values.model_api_key || ""}
        errors={validationErrors.model_api_key}
        locked={isModelApiKeyLocked(values, lockMetadata)}
        onChange={(nextValue) => {
          onChange("model_api_key", nextValue);
        }}
        type="text"
      />
      <TextField
        fieldName="model_api_url"
        metadata={fieldMetadata.model_api_url}
        value={values.model_api_url || ""}
        errors={validationErrors.model_api_url}
        onChange={(nextValue) => {
          onChange("model_api_url", nextValue);
        }}
        type="text"
      />
      <TextAreaField
        fieldName="question"
        metadata={fieldMetadata.question}
        value={values.question || ""}
        errors={validationErrors.question}
        onChange={(nextValue) => {
          onChange("question", nextValue);
        }}
      />
      <TextAreaField
        fieldName="evaluation_prompt"
        metadata={fieldMetadata.evaluation_prompt}
        value={values.evaluation_prompt || ""}
        errors={validationErrors.evaluation_prompt}
        onChange={(nextValue) => {
          onChange("evaluation_prompt", nextValue);
        }}
      />
      <TextField
        fieldName="judge0_api_key"
        metadata={fieldMetadata.judge0_api_key}
        value={values.judge0_api_key || ""}
        errors={validationErrors.judge0_api_key}
        locked={Boolean(lockMetadata?.lock_judge0_api_key)}
        onChange={(nextValue) => {
          onChange("judge0_api_key", nextValue);
        }}
        type="text"
      />
      <SelectField
        fieldName="language"
        metadata={fieldMetadata.language}
        value={values.language || ""}
        errors={validationErrors.language}
        onChange={(nextValue) => {
          onChange("language", nextValue);
        }}
      />
    </ul>
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

  return (
    <div
      className="editor-with-buttons shortanswer-react-studio coding-react-studio"
      data-block-kind="coding"
    >
      <div className="wrapper-comp-settings is-active editor-with-buttons" id="settings-tab">
        <StudioValidationSummary
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
