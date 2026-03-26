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
  CoachingStudioLockMetadata,
  CoachingStudioMeta,
  CoachingStudioPayload,
  CoachingStudioState,
  StudioFieldMetadata,
} from "./types";

type ValidationErrors = Record<string, string[]>;

function stringifyJsonValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return "";
  }
}

function normalizeInitialState(initialState: CoachingStudioState): CoachingStudioState {
  return {
    allow_reset: Boolean(initialState.allow_reset),
    blacklist: stringifyJsonValue(initialState.blacklist || []),
    character_1_avatar:
      typeof initialState.character_1_avatar === "string" ? initialState.character_1_avatar : "",
    character_1_name:
      typeof initialState.character_1_name === "string" ? initialState.character_1_name : "",
    character_1_prompt:
      typeof initialState.character_1_prompt === "string" ? initialState.character_1_prompt : "",
    character_1_role:
      typeof initialState.character_1_role === "string" ? initialState.character_1_role : "",
    character_2_avatar:
      typeof initialState.character_2_avatar === "string" ? initialState.character_2_avatar : "",
    character_2_name:
      typeof initialState.character_2_name === "string" ? initialState.character_2_name : "",
    character_2_prompt:
      typeof initialState.character_2_prompt === "string" ? initialState.character_2_prompt : "",
    character_2_role:
      typeof initialState.character_2_role === "string" ? initialState.character_2_role : "",
    coach_initial_message:
      typeof initialState.coach_initial_message === "string"
        ? initialState.coach_initial_message
        : "",
    coach_title: typeof initialState.coach_title === "string" ? initialState.coach_title : "",
    display_name: typeof initialState.display_name === "string" ? initialState.display_name : "",
    evaluator_prompt:
      typeof initialState.evaluator_prompt === "string" ? initialState.evaluator_prompt : "",
    initial_message:
      typeof initialState.initial_message === "string" ? initialState.initial_message : "",
    intro_text: typeof initialState.intro_text === "string" ? initialState.intro_text : "",
    max_attempts:
      initialState.max_attempts === null || typeof initialState.max_attempts === "undefined"
        ? ""
        : initialState.max_attempts,
    model: typeof initialState.model === "string" ? initialState.model : "",
    model_api_key:
      typeof initialState.model_api_key === "string" ? initialState.model_api_key : "",
    model_api_url:
      typeof initialState.model_api_url === "string" ? initialState.model_api_url : "",
    scenario_data: stringifyJsonValue(initialState.scenario_data || {}),
    workspace_title:
      typeof initialState.workspace_title === "string" ? initialState.workspace_title : "",
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

function buildSubmitPayload(values: CoachingStudioState) {
  return {
    allow_reset: Boolean(values.allow_reset),
    blacklist: values.blacklist || "[]",
    character_1_avatar: values.character_1_avatar || "",
    character_1_name: values.character_1_name || "",
    character_1_prompt: values.character_1_prompt || "",
    character_1_role: values.character_1_role || "",
    character_2_avatar: values.character_2_avatar || "",
    character_2_name: values.character_2_name || "",
    character_2_prompt: values.character_2_prompt || "",
    character_2_role: values.character_2_role || "",
    coach_initial_message: values.coach_initial_message || "",
    coach_title: values.coach_title || "",
    display_name: values.display_name || "",
    evaluator_prompt: values.evaluator_prompt || "",
    initial_message: values.initial_message || "",
    intro_text: values.intro_text || "",
    max_attempts: values.max_attempts,
    model: values.model || "",
    model_api_key: values.model_api_key || "",
    model_api_url: values.model_api_url || "",
    scenario_data: values.scenario_data || "{}",
    workspace_title: values.workspace_title || "",
  };
}

function isModelApiKeyLocked(values: CoachingStudioState, lockMetadata?: CoachingStudioLockMetadata) {
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
  rows,
  value,
}: {
  errors?: string[];
  fieldName: string;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: string) => void;
  rows?: number;
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
          rows={rows || 10}
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

function NumberField({
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
  value: number | string | null | undefined;
}) {
  return (
    <li className="field comp-setting-entry metadata_entry" data-field-name={fieldName}>
      <div className="wrapper-comp-setting">
        <label className="label setting-label" htmlFor={"xb-field-edit-" + fieldName}>
          {metadata?.display_name || fieldName}
        </label>
        <input
          id={"xb-field-edit-" + fieldName}
          type="number"
          className="field-data-control"
          min={0}
          step={1}
          value={value === null || typeof value === "undefined" ? "" : value}
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

function BooleanField({
  errors,
  fieldName,
  metadata,
  onChange,
  value,
}: {
  errors?: string[];
  fieldName: string;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: boolean) => void;
  value: boolean;
}) {
  return (
    <li className="field comp-setting-entry metadata_entry" data-field-name={fieldName}>
      <div className="wrapper-comp-setting">
        <label className="label setting-label" htmlFor={"xb-field-edit-" + fieldName}>
          {metadata?.display_name || fieldName}
        </label>
        <div className="shortanswer-studio-checkbox-control">
          <input
            id={"xb-field-edit-" + fieldName}
            type="checkbox"
            checked={value}
            onChange={(event) => {
              onChange(event.target.checked);
            }}
          />
        </div>
      </div>
      <FieldErrors errors={errors} />
      <FieldHelp metadata={metadata} />
    </li>
  );
}

function CoachingSettingsForm({
  fieldMetadata,
  lockMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  lockMetadata?: CoachingStudioLockMetadata;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: ValidationErrors;
  values: CoachingStudioState;
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
        fieldName="initial_message"
        metadata={fieldMetadata.initial_message}
        value={values.initial_message || ""}
        errors={validationErrors.initial_message}
        onChange={(nextValue) => {
          onChange("initial_message", nextValue);
        }}
      />
      <TextAreaField
        fieldName="coach_initial_message"
        metadata={fieldMetadata.coach_initial_message}
        value={values.coach_initial_message || ""}
        errors={validationErrors.coach_initial_message}
        onChange={(nextValue) => {
          onChange("coach_initial_message", nextValue);
        }}
      />
      <TextAreaField
        fieldName="scenario_data"
        metadata={fieldMetadata.scenario_data}
        value={values.scenario_data || ""}
        errors={validationErrors.scenario_data}
        rows={14}
        onChange={(nextValue) => {
          onChange("scenario_data", nextValue);
        }}
      />
      <TextField
        fieldName="workspace_title"
        metadata={fieldMetadata.workspace_title}
        value={values.workspace_title || ""}
        errors={validationErrors.workspace_title}
        onChange={(nextValue) => {
          onChange("workspace_title", nextValue);
        }}
        type="text"
      />
      <TextField
        fieldName="coach_title"
        metadata={fieldMetadata.coach_title}
        value={values.coach_title || ""}
        errors={validationErrors.coach_title}
        onChange={(nextValue) => {
          onChange("coach_title", nextValue);
        }}
        type="text"
      />
      <TextAreaField
        fieldName="intro_text"
        metadata={fieldMetadata.intro_text}
        value={values.intro_text || ""}
        errors={validationErrors.intro_text}
        onChange={(nextValue) => {
          onChange("intro_text", nextValue);
        }}
      />
      <TextField
        fieldName="character_1_name"
        metadata={fieldMetadata.character_1_name}
        value={values.character_1_name || ""}
        errors={validationErrors.character_1_name}
        onChange={(nextValue) => {
          onChange("character_1_name", nextValue);
        }}
        type="text"
      />
      <TextField
        fieldName="character_1_role"
        metadata={fieldMetadata.character_1_role}
        value={values.character_1_role || ""}
        errors={validationErrors.character_1_role}
        onChange={(nextValue) => {
          onChange("character_1_role", nextValue);
        }}
        type="text"
      />
      <TextAreaField
        fieldName="character_1_prompt"
        metadata={fieldMetadata.character_1_prompt}
        value={values.character_1_prompt || ""}
        errors={validationErrors.character_1_prompt}
        onChange={(nextValue) => {
          onChange("character_1_prompt", nextValue);
        }}
      />
      <TextField
        fieldName="character_1_avatar"
        metadata={fieldMetadata.character_1_avatar}
        value={values.character_1_avatar || ""}
        errors={validationErrors.character_1_avatar}
        onChange={(nextValue) => {
          onChange("character_1_avatar", nextValue);
        }}
        type="text"
      />
      <TextField
        fieldName="character_2_name"
        metadata={fieldMetadata.character_2_name}
        value={values.character_2_name || ""}
        errors={validationErrors.character_2_name}
        onChange={(nextValue) => {
          onChange("character_2_name", nextValue);
        }}
        type="text"
      />
      <TextField
        fieldName="character_2_role"
        metadata={fieldMetadata.character_2_role}
        value={values.character_2_role || ""}
        errors={validationErrors.character_2_role}
        onChange={(nextValue) => {
          onChange("character_2_role", nextValue);
        }}
        type="text"
      />
      <TextAreaField
        fieldName="character_2_prompt"
        metadata={fieldMetadata.character_2_prompt}
        value={values.character_2_prompt || ""}
        errors={validationErrors.character_2_prompt}
        onChange={(nextValue) => {
          onChange("character_2_prompt", nextValue);
        }}
      />
      <TextField
        fieldName="character_2_avatar"
        metadata={fieldMetadata.character_2_avatar}
        value={values.character_2_avatar || ""}
        errors={validationErrors.character_2_avatar}
        onChange={(nextValue) => {
          onChange("character_2_avatar", nextValue);
        }}
        type="text"
      />
      <TextAreaField
        fieldName="evaluator_prompt"
        metadata={fieldMetadata.evaluator_prompt}
        value={values.evaluator_prompt || ""}
        errors={validationErrors.evaluator_prompt}
        onChange={(nextValue) => {
          onChange("evaluator_prompt", nextValue);
        }}
      />
      <TextAreaField
        fieldName="blacklist"
        metadata={fieldMetadata.blacklist}
        value={values.blacklist || ""}
        errors={validationErrors.blacklist}
        rows={6}
        onChange={(nextValue) => {
          onChange("blacklist", nextValue);
        }}
      />
      <NumberField
        fieldName="max_attempts"
        metadata={fieldMetadata.max_attempts}
        value={values.max_attempts}
        errors={validationErrors.max_attempts}
        onChange={(nextValue) => {
          onChange("max_attempts", nextValue);
        }}
      />
      <BooleanField
        fieldName="allow_reset"
        metadata={fieldMetadata.allow_reset}
        value={Boolean(values.allow_reset)}
        errors={validationErrors.allow_reset}
        onChange={(nextValue) => {
          onChange("allow_reset", nextValue);
        }}
      />
    </ul>
  );
}

export default function CoachingStudioApp({
  payload,
  runtime,
}: {
  payload: CoachingStudioPayload;
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
  const meta: CoachingStudioMeta = payload.meta || {};
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
      id: "coaching.studio.saving",
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
              id: "coaching.studio.saveFailed",
              defaultMessage: "Unable to update settings",
            }),
            message: intl.formatMessage({
              id: "coaching.studio.validationError",
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
              id: "coaching.studio.validationError",
              defaultMessage: "Please fix the validation issues and try again.",
            });
          }
        }

        if (!inlineRequestError) {
          inlineRequestError = getSaveErrorMessage(
            error,
            intl.formatMessage({
              id: "coaching.studio.genericError",
              defaultMessage:
                "This may be happening because of an error with our server or your internet connection. Try refreshing the page or making sure you are online.",
            }),
          );
        }

        setRequestError(inlineRequestError);
        setIsSaving(false);
        notifyRuntime(runtime, "error", {
          title: intl.formatMessage({
            id: "coaching.studio.saveFailed",
            defaultMessage: "Unable to update settings",
          }),
          message: inlineRequestError,
        });
      });
  }

  return (
    <div
      className="editor-with-buttons shortanswer-react-studio coaching-react-studio"
      data-block-kind="coaching"
    >
      <div className="wrapper-comp-settings is-active editor-with-buttons" id="settings-tab">
        <StudioValidationSummary
          requestError={requestError}
          validationWarnings={validationWarnings}
        />
        <CoachingSettingsForm
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
                      id: "coaching.studio.savingButton",
                      defaultMessage: "Saving...",
                    })
                  : intl.formatMessage({
                      id: "coaching.studio.save",
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
                  id: "coaching.studio.cancel",
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
