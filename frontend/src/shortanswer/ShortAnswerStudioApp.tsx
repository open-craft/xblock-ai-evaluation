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
  ShortAnswerStudioPayload,
  ShortAnswerStudioState,
  StudioLockMetadata,
} from "./types";

function normalizeAttachmentUrls(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    return typeof entry === "string" ? entry : "";
  });
}

function normalizeInitialState(initialState: ShortAnswerStudioState): ShortAnswerStudioState {
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
    max_responses:
      initialState.max_responses === null || typeof initialState.max_responses === "undefined"
        ? ""
        : initialState.max_responses,
    allow_reset: Boolean(initialState.allow_reset),
    character_image:
      typeof initialState.character_image === "string" ? initialState.character_image : "",
    attachment_urls: normalizeAttachmentUrls(initialState.attachment_urls),
  };
}

function buildSubmitPayload(values: ShortAnswerStudioState) {
  return {
    display_name: values.display_name || "",
    model: values.model || "",
    model_api_key: values.model_api_key || "",
    model_api_url: values.model_api_url || "",
    question: values.question || "",
    evaluation_prompt: values.evaluation_prompt || "",
    max_responses: values.max_responses,
    allow_reset: Boolean(values.allow_reset),
    character_image: values.character_image || "",
    attachment_urls: normalizeAttachmentUrls(values.attachment_urls),
  };
}

function AttachmentUrlsEditor({
  errors,
  metadata,
  value,
  onChange,
}: {
  errors?: string[];
  metadata?: StudioFieldMetadata;
  value: string[];
  onChange: (nextValue: string[]) => void;
}) {
  const intl = useIntl();
  const attachmentUrls = value.length > 0 ? value : [""];
  const removeAttachmentLabel = intl.formatMessage({
    id: "shortanswer.studio.removeAttachment",
    defaultMessage: "Remove attachment",
  });

  return (
    <li className="field comp-setting-entry metadata_entry" data-field-name="attachment_urls">
      <div className="wrapper-comp-setting">
        <label className="label setting-label shortanswer-studio-section-label">
          {metadata?.display_name || "Attachment URLs"}
        </label>
        <div className="shortanswer-studio-attachment-list">
          {attachmentUrls.map((attachmentUrl, index) => {
            return (
              <div className="shortanswer-studio-attachment-row" key={String(index)}>
                <div className="shortanswer-studio-attachment-input-shell">
                  <input
                    type="text"
                    className="field-data-control"
                    value={attachmentUrl}
                    onChange={(event) => {
                      const nextUrls = attachmentUrls.slice();
                      nextUrls[index] = event.target.value;
                      onChange(nextUrls);
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="button shortanswer-studio-attachment-remove"
                  aria-label={removeAttachmentLabel}
                  title={removeAttachmentLabel}
                  onClick={() => {
                    const nextUrls = attachmentUrls.filter((_, urlIndex) => urlIndex !== index);
                    onChange(nextUrls);
                  }}
                  disabled={attachmentUrls.length === 1 && !attachmentUrl}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="button shortanswer-studio-attachment-add"
            onClick={() => {
              onChange(attachmentUrls.concat(""));
            }}
          >
            {intl.formatMessage({
              id: "shortanswer.studio.addAttachment",
              defaultMessage: "Add URL",
            })}
          </button>
        </div>
        {errors && errors.length > 0 ? (
          <ul className="shortanswer-studio-attachment-errors">
            {errors.map((error, errorIndex) => (
              <li key={String(errorIndex)}>{error}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <FieldHelp metadata={metadata} />
    </li>
  );
}

function ShortAnswerSettingsForm({
  lockMetadata,
  validationErrors,
  values,
  fieldMetadata,
  onChange,
}: {
  lockMetadata?: StudioLockMetadata;
  validationErrors: ValidationErrors;
  values: ShortAnswerStudioState;
  fieldMetadata: Record<string, StudioFieldMetadata>;
  onChange: (fieldName: string, nextValue: unknown) => void;
}) {
  const modelApiKeyLocked = isModelApiKeyLocked(values, lockMetadata);
  const modelChoices = Array.isArray(fieldMetadata.model?.choices)
    ? fieldMetadata.model.choices
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

      <Form.Group controlId="xb-field-edit-max_responses" isInvalid={Boolean(validationErrors.max_responses)}>
        <Form.Label>{fieldMetadata.max_responses?.display_name || "max_responses"}</Form.Label>
        <Form.Control
          type="number"
          min={1}
          max={15}
          step={1}
          value={values.max_responses === null || typeof values.max_responses === "undefined" ? "" : values.max_responses}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("max_responses", event.target.value);
          }}
        />
        <FieldErrors errors={validationErrors.max_responses} />
        <FieldHelp metadata={fieldMetadata.max_responses} />
      </Form.Group>

      <Form.Group controlId="xb-field-edit-allow_reset" isInvalid={Boolean(validationErrors.allow_reset)}>
        <Form.Checkbox
          checked={Boolean(values.allow_reset)}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("allow_reset", event.target.checked);
          }}
        >
          {fieldMetadata.allow_reset?.display_name || "allow_reset"}
        </Form.Checkbox>
        <FieldErrors errors={validationErrors.allow_reset} />
        <FieldHelp metadata={fieldMetadata.allow_reset} />
      </Form.Group>

      <Form.Group controlId="xb-field-edit-character_image" isInvalid={Boolean(validationErrors.character_image)}>
        <Form.Label>{fieldMetadata.character_image?.display_name || "character_image"}</Form.Label>
        <Form.Control
          type="text"
          value={values.character_image || ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("character_image", event.target.value);
          }}
        />
        <FieldErrors errors={validationErrors.character_image} />
        <FieldHelp metadata={fieldMetadata.character_image} />
      </Form.Group>

      <AttachmentUrlsEditor
        metadata={fieldMetadata.attachment_urls}
        value={values.attachment_urls || []}
        errors={validationErrors.attachment_urls}
        onChange={(nextValue) => {
          onChange("attachment_urls", nextValue);
        }}
      />
    </Form>
  );
}

export default function ShortAnswerStudioApp({
  payload,
  runtime,
}: {
  payload: ShortAnswerStudioPayload;
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
  const fieldMetadata = payload.meta.field_metadata || {};
  const lockMetadata = payload.meta.lock_metadata;

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  function handleSave(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();

    if (!payload.handler_urls.studio_submit || isSaving) {
      return;
    }

    const savingMessage = intl.formatMessage({
      id: "shortanswer.studio.saving",
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
              id: "shortanswer.studio.saveFailed",
              defaultMessage: "Unable to update settings",
            }),
            message: intl.formatMessage({
              id: "shortanswer.studio.validationError",
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
              id: "shortanswer.studio.validationError",
              defaultMessage: "Please fix the validation issues and try again.",
            });
          }
        }

        if (!inlineRequestError) {
          inlineRequestError = getSaveErrorMessage(
            error,
            intl.formatMessage({
              id: "shortanswer.studio.genericError",
              defaultMessage:
                "This may be happening because of an error with our server or your internet connection. Try refreshing the page or making sure you are online.",
            }),
          );
        }

        setRequestError(inlineRequestError);
        setIsSaving(false);
        notifyRuntime(runtime, "error", {
          title: intl.formatMessage({
            id: "shortanswer.studio.saveFailed",
            defaultMessage: "Unable to update settings",
          }),
          message: inlineRequestError,
        });
      });
  }

  const hasFieldErrors = Object.keys(validationErrors).length > 0;

  return (
    <div className="editor-with-buttons shortanswer-react-studio" data-block-kind="shortanswer">
      <div className="wrapper-comp-settings is-active editor-with-buttons" id="settings-tab">
        <StudioValidationSummary
          hasFieldErrors={hasFieldErrors}
          requestError={requestError}
          validationWarnings={validationWarnings}
        />
        <ShortAnswerSettingsForm
          values={values}
          validationErrors={validationErrors}
          lockMetadata={lockMetadata}
          fieldMetadata={fieldMetadata}
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
                      id: "shortanswer.studio.savingButton",
                      defaultMessage: "Saving...",
                    })
                  : intl.formatMessage({
                      id: "shortanswer.studio.save",
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
                  id: "shortanswer.studio.cancel",
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
