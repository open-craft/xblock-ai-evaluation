import React from "react";
import { useIntl } from "react-intl";
import { Form } from "@openedx/paragon";

import { ValidationErrors } from "../shared/studio";
import { FieldErrors, FieldHelp } from "../shared/StudioFormFields";
import { StudioFieldMetadata } from "../shared/types";
import { ShortAnswerStudioState } from "./types";

interface ShortAnswerUploadFieldsProps {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  maxFileUploadsCeiling: number;
  validationErrors: ValidationErrors;
  values: ShortAnswerStudioState;
  onChange: (fieldName: string, nextValue: unknown) => void;
}

/** The File Upload toggle and, while it's on, the Max File Uploads field. */
export function ShortAnswerUploadFields({
  fieldMetadata,
  maxFileUploadsCeiling,
  validationErrors,
  values,
  onChange,
}: ShortAnswerUploadFieldsProps) {
  const intl = useIntl();

  return (
    <>
      <Form.Group
        controlId="xb-field-edit-allow_learner_uploads"
        isInvalid={Boolean(validationErrors.allow_learner_uploads)}
      >
        <Form.Label>{fieldMetadata.allow_learner_uploads.display_name}</Form.Label>
        <Form.RadioSet
          name="allow_learner_uploads"
          isInline
          value={String(values.allow_learner_uploads)}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange("allow_learner_uploads", event.target.value === "true");
          }}
        >
          <Form.Radio value="true">
            {intl.formatMessage({ id: "shortanswer.studio.fileUpload.yes", defaultMessage: "Yes" })}
          </Form.Radio>
          <Form.Radio value="false">
            {intl.formatMessage({ id: "shortanswer.studio.fileUpload.no", defaultMessage: "No" })}
          </Form.Radio>
        </Form.RadioSet>
        <FieldErrors errors={validationErrors.allow_learner_uploads} />
        <FieldHelp metadata={fieldMetadata.allow_learner_uploads} />
      </Form.Group>

      {values.allow_learner_uploads ? (
        <Form.Group controlId="xb-field-edit-max_file_uploads" isInvalid={Boolean(validationErrors.max_file_uploads)}>
          <Form.Label>{fieldMetadata.max_file_uploads.display_name}</Form.Label>
          <Form.Control
            type="number"
            min={1}
            max={maxFileUploadsCeiling}
            step={1}
            value={values.max_file_uploads ?? ""}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              onChange("max_file_uploads", event.target.value);
            }}
          />
          <FieldErrors errors={validationErrors.max_file_uploads} />
          <FieldHelp metadata={fieldMetadata.max_file_uploads} />
        </Form.Group>
      ) : null}
    </>
  );
}
