import React, { useCallback, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Formik, useFormikContext } from "formik";
import * as Yup from "yup";
import { Button, Form } from "@openedx/paragon";
import { RequestError } from "../shared/request";
import { FieldErrors, FieldHelp } from "../shared/StudioFormFields";
import { StudioEditorLayout } from "../shared/StudioEditorLayout";
import { StudioValidationSummary } from "../shared/StudioValidationSummary";
import {
  collectYupErrors,
  getSaveErrorMessage,
  isModelApiKeyLocked,
  normalizeStudioSaveResponse,
  normalizeValidationErrors,
  normalizeValidationWarnings,
  notifyRuntime,
  submitStudioPayload,
  ValidationErrors,
} from "../shared/studio";
import { StudioFieldMetadata, XBlockRuntime } from "../shared/types";
import {
  ShortAnswerStudioPayload,
  ShortAnswerStudioState,
  StudioLockMetadata,
} from "./types";

const shortAnswerSchema = Yup.object({
  allow_reset: Yup.boolean()
    .transform((_value: unknown, original: unknown) => Boolean(original))
    .default(false),
  attachment_urls: Yup.array(Yup.string().ensure()).ensure(),
  character_image: Yup.string().ensure(),
  display_name: Yup.string().ensure(),
  evaluation_prompt: Yup.string().ensure(),
  max_responses: Yup.mixed()
    .transform((value: unknown) => (value === null || value === undefined ? "" : value))
    .default("")
    .test(
      "valid-max-responses",
      "max responses must be an integer between 1 and 30",
      (value) => {
        if (value === "" || value === null || value === undefined) return false;
        const num = Number(value);
        return Number.isInteger(num) && num >= 1 && num <= 30;
      },
    ),
  model: Yup.string().ensure()
    .required("Model field is mandatory - please select one from the dropdown."),
  model_api_key: Yup.string().ensure(),
  model_api_url: Yup.string().ensure(),
  show_display_name: Yup.boolean(),
  question: Yup.string().ensure()
    .when("hide_question", {
      is: false,
      then: (schema) => schema.required("Question field is mandatory"),
    }),
  hide_question: Yup.boolean()
    .transform((_value: unknown, original: unknown) => Boolean(original))
    .default(false),
});

function normalizeAttachmentUrls(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    return typeof entry === "string" ? entry : "";
  });
}

function buildSubmitPayload(values: ShortAnswerStudioState) {
  return {
    display_name: values.display_name || "",
    model: values.model || "",
    model_api_key: values.model_api_key || "",
    model_api_url: values.model_api_url || "",
    show_display_name: values.show_display_name,
    question: values.question || "",
    hide_question: Boolean(values.hide_question),
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
    <Form.Group isInvalid={Boolean(errors && errors.length > 0)}>
      <Form.Label>{metadata?.display_name || "Attachment URLs"}</Form.Label>
      <div className="shortanswer-studio-attachment-list">
        {attachmentUrls.map((attachmentUrl, index) => (
          <div className="shortanswer-studio-attachment-row" key={String(index)}>
            <Form.Control
              type="text"
              value={attachmentUrl}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const nextUrls = attachmentUrls.slice();
                nextUrls[index] = event.target.value;
                onChange(nextUrls);
              }}
            />
            <Button
              variant="outline-danger"
              size="sm"
              aria-label={removeAttachmentLabel}
              title={removeAttachmentLabel}
              onClick={() => {
                const nextUrls = attachmentUrls.filter((_, urlIndex) => urlIndex !== index);
                onChange(nextUrls);
              }}
              disabled={attachmentUrls.length === 1 && !attachmentUrl}
            >
              &times;
            </Button>
          </div>
        ))}
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => {
            onChange(attachmentUrls.concat(""));
          }}
        >
          {intl.formatMessage({
            id: "shortanswer.studio.addAttachment",
            defaultMessage: "Add URL",
          })}
        </Button>
      </div>
      <FieldErrors errors={errors} />
      <FieldHelp metadata={metadata} />
    </Form.Group>
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

      <Form.Group controlId="xb-field-edit-show_display_name" isInvalid={Boolean(validationErrors.show_display_name)}>
        <Form.Checkbox
          checked={Boolean(values.show_display_name)}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("show_display_name", event.target.checked);
          }}
        >
          {fieldMetadata.show_display_name.display_name}
        </Form.Checkbox>
        <FieldErrors errors={validationErrors.show_display_name} />
        <FieldHelp metadata={fieldMetadata.show_display_name} />
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

      <Form.Group controlId="xb-field-edit-hide_question">
        <Form.Checkbox
          checked={Boolean(values.hide_question)}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("hide_question", event.target.checked);
          }}
        >
          {fieldMetadata.hide_question?.display_name || "Hide question"}
        </Form.Checkbox>
        <FieldHelp metadata={fieldMetadata.hide_question} />
      </Form.Group>

      <Form.Group controlId="xb-field-edit-question" isInvalid={Boolean(validationErrors.question)}>
        <Form.Label>{fieldMetadata.question?.display_name || "question"}</Form.Label>
        <Form.Control
          as="textarea"
          rows={10}
          disabled={Boolean(values.hide_question)}
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
          max={30}
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

function ShortAnswerStudioFormContent({
  payload,
  runtime,
}: {
  payload: ShortAnswerStudioPayload;
  runtime?: XBlockRuntime;
}) {
  const formik = useFormikContext<ShortAnswerStudioState>();
  const valuesRef = useRef(formik.values);
  valuesRef.current = formik.values;
  const intl = useIntl();
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [requestError, setRequestError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const fieldMetadata = payload.meta.field_metadata || {};
  const lockMetadata = payload.meta.lock_metadata;

  const handleSave = useCallback(async function handleSave() {
    if (!payload.handler_urls.studio_submit || isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;

    const validationMessage = intl.formatMessage({
      id: "shortanswer.studio.validationError",
      defaultMessage: "Please fix the validation issues and try again.",
    });

    try {
      await shortAnswerSchema.validate(valuesRef.current, { abortEarly: false });
    } catch (error: unknown) {
      if (error instanceof Yup.ValidationError) {
        setValidationErrors(collectYupErrors(error));
        setValidationWarnings([]);
        setRequestError(validationMessage);
        notifyRuntime(runtime, "error", {
          title: intl.formatMessage({
            id: "shortanswer.studio.saveFailed",
            defaultMessage: "Unable to update settings",
          }),
          message: validationMessage,
        });
        isSavingRef.current = false;
        return;
      }
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

    try {
      const response = await submitStudioPayload(
        payload.handler_urls.studio_submit,
        buildSubmitPayload(valuesRef.current),
      );

      setValidationErrors(normalizeValidationErrors(response.validation_errors));
      setValidationWarnings(normalizeValidationWarnings(response.validation_warnings));
      isSavingRef.current = false;
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
    } catch (error: unknown) {
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
      isSavingRef.current = false;
      setIsSaving(false);
      notifyRuntime(runtime, "error", {
        title: intl.formatMessage({
          id: "shortanswer.studio.saveFailed",
          defaultMessage: "Unable to update settings",
        }),
        message: inlineRequestError,
      });
    }
  }, [intl, payload.handler_urls.studio_submit, runtime]);

  const hasFieldErrors = Object.keys(validationErrors).length > 0;

  const handleCancel = useCallback(() => {
    if (isSavingRef.current) {
      return;
    }
    notifyRuntime(runtime, "cancel", {});
  }, [runtime]);

  return (
    <div className="shortanswer-react-studio" data-block-kind="shortanswer">
      <StudioEditorLayout
        i18nPrefix="shortanswer"
        isSaving={isSaving}
        onCancel={handleCancel}
        onSave={handleSave}
      >
        <div className="wrapper-comp-settings is-active" id="settings-tab">
          <StudioValidationSummary
            hasFieldErrors={hasFieldErrors}
            requestError={requestError}
            validationWarnings={validationWarnings}
          />
          <ShortAnswerSettingsForm
            values={formik.values}
            validationErrors={validationErrors}
            lockMetadata={lockMetadata}
            fieldMetadata={fieldMetadata}
            onChange={(fieldName, nextValue) => {
              formik.setFieldValue(fieldName, nextValue);
            }}
          />
        </div>
      </StudioEditorLayout>
    </div>
  );
}

export default function ShortAnswerStudioApp({
  payload,
  runtime,
}: {
  payload: ShortAnswerStudioPayload;
  runtime?: XBlockRuntime;
}) {
  const initialValues = useMemo(
    () =>
      shortAnswerSchema.cast(payload.initial_state, {
        stripUnknown: true,
      }) as ShortAnswerStudioState,
    [payload.initial_state],
  );

  return (
    <Formik<ShortAnswerStudioState>
      initialValues={initialValues}
      enableReinitialize
      onSubmit={() => {}}
    >
      <ShortAnswerStudioFormContent payload={payload} runtime={runtime} />
    </Formik>
  );
}
