import React, { useCallback, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Formik, useFormikContext } from "formik";
import * as Yup from "yup";
import { Form } from "@openedx/paragon";
import { RequestError } from "../shared/request";
import { FieldErrors, FieldHelp } from "../shared/StudioFormFields";
import { StudioValidationSummary } from "../shared/StudioValidationSummary";
import { useStudioModalActions } from "../shared/useStudioModalActions";
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
  CodingStudioLockMetadata,
  CodingStudioMeta,
  CodingStudioPayload,
  CodingStudioState,
} from "./types";

const codingSchema = Yup.object({
  display_name: Yup.string().ensure(),
  evaluation_prompt: Yup.string().ensure(),
  judge0_api_key: Yup.string().ensure(),
  language: Yup.string().ensure(),
  model: Yup.string().ensure()
    .required("Model field is mandatory - please select one from the dropdown."),
  model_api_key: Yup.string().ensure(),
  model_api_url: Yup.string().ensure(),
  question: Yup.string().ensure()
    .required("Question field is mandatory"),
});

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

function CodingStudioFormContent({
  payload,
  runtime,
}: {
  payload: CodingStudioPayload;
  runtime?: XBlockRuntime;
}) {
  const formik = useFormikContext<CodingStudioState>();
  const valuesRef = useRef(formik.values);
  valuesRef.current = formik.values;
  const intl = useIntl();
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [requestError, setRequestError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const meta: CodingStudioMeta = payload.meta || {};
  const fieldMetadata = meta.field_metadata || {};
  const lockMetadata = meta.lock_metadata;

  const handleSave = useCallback(async function handleSave() {
    if (!payload.handler_urls.studio_submit || isSaving) {
      return;
    }

    const validationMessage = intl.formatMessage({
      id: "coding.studio.validationError",
      defaultMessage: "Please fix the validation issues and try again.",
    });

    try {
      await codingSchema.validate(valuesRef.current, { abortEarly: false });
    } catch (error: unknown) {
      if (error instanceof Yup.ValidationError) {
        setValidationErrors(collectYupErrors(error));
        setValidationWarnings([]);
        setRequestError(validationMessage);
        notifyRuntime(runtime, "error", {
          title: intl.formatMessage({
            id: "coding.studio.saveFailed",
            defaultMessage: "Unable to update settings",
          }),
          message: validationMessage,
        });
        return;
      }
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

    try {
      const response = await submitStudioPayload(
        payload.handler_urls.studio_submit,
        codingSchema.cast(valuesRef.current),
      );

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
    } catch (error: unknown) {
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
    }
  }, [intl, isSaving, payload.handler_urls.studio_submit, runtime]);

  const hasFieldErrors = Object.keys(validationErrors).length > 0;

  const handleCancel = useCallback(() => {
    notifyRuntime(runtime, "cancel", {});
  }, [runtime]);

  useStudioModalActions({
    rootSelector: ".coding-react-studio",
    intl,
    isSaving,
    onSave: handleSave,
    onCancel: handleCancel,
    i18nPrefix: "coding",
  });

  return (
    <div
      className="shortanswer-react-studio coding-react-studio"
      data-block-kind="coding"
    >
      <div className="wrapper-comp-settings is-active" id="settings-tab">
        <StudioValidationSummary
          hasFieldErrors={hasFieldErrors}
          requestError={requestError}
          validationWarnings={validationWarnings}
        />
        <CodingSettingsForm
          fieldMetadata={fieldMetadata}
          lockMetadata={lockMetadata}
          validationErrors={validationErrors}
          values={formik.values}
          onChange={(fieldName, nextValue) => {
            formik.setFieldValue(fieldName, nextValue);
          }}
        />
      </div>
    </div>
  );
}

export default function CodingStudioApp({
  payload,
  runtime,
}: {
  payload: CodingStudioPayload;
  runtime?: XBlockRuntime;
}) {
  const initialValues = useMemo(
    () =>
      codingSchema.cast(payload.initial_state, {
        stripUnknown: true,
      }) as CodingStudioState,
    [payload.initial_state],
  );

  return (
    <Formik<CodingStudioState>
      initialValues={initialValues}
      enableReinitialize
      onSubmit={() => {}}
    >
      <CodingStudioFormContent payload={payload} runtime={runtime} />
    </Formik>
  );
}
