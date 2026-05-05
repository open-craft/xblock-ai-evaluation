import React, { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Formik, useFormikContext } from "formik";
import * as Yup from "yup";
import { Alert, Button, Form } from "@openedx/paragon";

import { RequestError } from "../shared/request";
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
} from "../shared/studio";
import { XBlockRuntime } from "../shared/types";
import {
  CoachingListItem,
  getBlacklistItems,
  getScenarioEditorModel,
  getScenarioListItems,
  sanitizeBlacklistValue,
  updateBlacklistItems,
  updateScenarioDataValue,
  updateScenarioListItems,
} from "./coachingStudioAdapters";
import {
  COACHING_STUDIO_SECTIONS,
  CoachingStudioSectionId,
} from "./coachingStudioSections";
import {
  CoachingStudioValidationErrors,
  getFirstSectionWithErrors,
  getSectionErrorCount,
} from "./coachingStudioValidation";
import { StudioFieldMetadata } from "../shared/types";
import {
  CoachingStudioLockMetadata,
  CoachingStudioMeta,
  CoachingStudioPayload,
  CoachingStudioState,
} from "./types";

const coachingSchema = Yup.object({
  allow_reset: Yup.boolean()
    .transform((_value: unknown, original: unknown) => Boolean(original))
    .default(false),
  blacklist: Yup.mixed()
    .transform((value: unknown) => (Array.isArray(value) ? value : []))
    .default(() => []),
  character_1_avatar: Yup.string().ensure(),
  character_1_name: Yup.string().ensure(),
  character_1_prompt: Yup.string().ensure(),
  character_1_role: Yup.string().ensure(),
  character_2_avatar: Yup.string().ensure(),
  character_2_name: Yup.string().ensure(),
  character_2_prompt: Yup.string().ensure(),
  character_2_role: Yup.string().ensure(),
  coach_initial_message: Yup.string().ensure(),
  coach_title: Yup.string().ensure(),
  display_name: Yup.string().ensure(),
  evaluator_prompt: Yup.string().ensure(),
  initial_message: Yup.string().ensure(),
  intro_text: Yup.string().ensure(),
  max_attempts: Yup.mixed()
    .transform((value: unknown) => (value === null || value === undefined ? "" : value))
    .default(""),
  model: Yup.string().ensure()
    .required("Model field is mandatory - please select one from the dropdown."),
  model_api_key: Yup.string().ensure(),
  model_api_url: Yup.string().ensure(),
  scenario_data: Yup.mixed()
    .transform((value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
      }
      return { case_details: "", evaluation_criteria: [], learning_objectives: [] };
    })
    .default(() => ({ case_details: "", evaluation_criteria: [], learning_objectives: [] }))
    .test("case-details-length", "", function testCaseDetailsLength(value) {
      const caseDetails = (value as Record<string, unknown>)?.case_details;
      if (typeof caseDetails === "string" && caseDetails.length > 1000) {
        return this.createError({
          path: "scenario_case_details",
          message: "Scenario text must be 1000 characters or fewer.",
        });
      }
      return true;
    }),
  workspace_title: Yup.string().ensure(),
});

function updateListItemAtIndex(items: CoachingListItem[], index: number, nextValue: string) {
  return items.map((item, itemIndex) => {
    return itemIndex === index ? { value: nextValue } : item;
  });
}

function appendListItem(items: CoachingListItem[]) {
  return [...items, { value: "" }];
}

function removeListItemAtIndex(items: CoachingListItem[], index: number) {
  return items.filter((_, itemIndex) => {
    return itemIndex !== index;
  });
}

function hasInvalidRows(items: CoachingListItem[]) {
  return items.some((item) => {
    return Boolean(item.error);
  });
}

function buildFrontendValidationErrors(values: CoachingStudioState): CoachingStudioValidationErrors {
  const validationErrors: CoachingStudioValidationErrors = {};
  const learningObjectives = getScenarioListItems(values.scenario_data, "learning_objectives");
  const evaluationCriteria = getScenarioListItems(values.scenario_data, "evaluation_criteria");
  const blacklistItems = getBlacklistItems(values.blacklist);

  if (hasInvalidRows(learningObjectives)) {
    validationErrors.scenario_learning_objectives = [
      "Resolve the invalid learning objective rows below.",
    ];
  }

  if (hasInvalidRows(evaluationCriteria)) {
    validationErrors.scenario_evaluation_criteria = [
      "Resolve the invalid evaluation criteria rows below.",
    ];
  }

  if (hasInvalidRows(blacklistItems)) {
    validationErrors.blacklist = [
      "Resolve the invalid blocked phrase rows below.",
    ];
  }

  return validationErrors;
}

function buildSubmitPayload(values: CoachingStudioState) {
  return {
    allow_reset: Boolean(values.allow_reset),
    blacklist: sanitizeBlacklistValue(values.blacklist),
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
    scenario_data: values.scenario_data || {},
    workspace_title: values.workspace_title || "",
  };
}

function getFieldLabel(metadata: StudioFieldMetadata | undefined, fallbackLabel: string) {
  return metadata?.display_name || fallbackLabel;
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) {
    return null;
  }

  return (
    <ul className="coaching-studio-field-errors">
      {errors.map((error, index) => {
        return <li key={String(index)}>{error}</li>;
      })}
    </ul>
  );
}

function FieldDescription({ description, helpText }: { description?: string; helpText?: string }) {
  if (!description && !helpText) {
    return null;
  }

  return (
    <div className="coaching-studio-field-copy">
      {description ? <Form.Text className="coaching-studio-field-description">{description}</Form.Text> : null}
      {!description && helpText ? (
        <Form.Text className="coaching-studio-field-help">{helpText}</Form.Text>
      ) : null}
    </div>
  );
}

function TextInputField({
  counter,
  description,
  errors,
  fieldName,
  locked,
  metadata,
  onChange,
  placeholder,
  value,
}: {
  counter?: string;
  description?: string;
  errors?: string[];
  fieldName: string;
  locked?: boolean;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  value: string;
}) {
  const label = getFieldLabel(metadata, fieldName);

  return (
    <Form.Group className="coaching-studio-field" isInvalid={Boolean(errors?.length)}>
      <div className="coaching-studio-field-header">
        <div className="coaching-studio-field-title-row">
          <Form.Label className="coaching-studio-field-label">
            {label}
            {locked ? <span className="ai-eval-lock-badge"> Locked by admin</span> : null}
          </Form.Label>
          {counter ? <p className="coaching-studio-field-counter">{counter}</p> : null}
        </div>
        <FieldDescription description={description} helpText={metadata?.help} />
      </div>
      <div className="coaching-studio-field-control">
        <Form.Control
          className="coaching-studio-input"
          disabled={Boolean(locked)}
          placeholder={placeholder}
          value={value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value);
          }}
        />
      </div>
      <FieldErrors errors={errors} />
    </Form.Group>
  );
}

function NumberField({
  description,
  errors,
  fieldName,
  metadata,
  onChange,
  value,
}: {
  description?: string;
  errors?: string[];
  fieldName: string;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: string) => void;
  value: number | string | null | undefined;
}) {
  const label = getFieldLabel(metadata, fieldName);

  return (
    <Form.Group className="coaching-studio-field" isInvalid={Boolean(errors?.length)}>
      <div className="coaching-studio-field-header">
        <div className="coaching-studio-field-title-row">
          <Form.Label className="coaching-studio-field-label">{label}</Form.Label>
        </div>
        <FieldDescription description={description} helpText={metadata?.help} />
      </div>
      <div className="coaching-studio-field-control">
        <Form.Control
          className="coaching-studio-input coaching-studio-input--compact"
          type="number"
          min={0}
          step={1}
          value={value === null || typeof value === "undefined" ? "" : value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value);
          }}
        />
      </div>
      <FieldErrors errors={errors} />
    </Form.Group>
  );
}

function TextAreaField({
  counter,
  description,
  errors,
  fieldName,
  metadata,
  onChange,
  rows,
  showLabel = true,
  value,
}: {
  counter?: string;
  description?: string;
  errors?: string[];
  fieldName: string;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: string) => void;
  rows?: number;
  showLabel?: boolean;
  value: string;
}) {
  const label = getFieldLabel(metadata, fieldName);

  return (
    <Form.Group className="coaching-studio-field" isInvalid={Boolean(errors?.length)}>
      <div className="coaching-studio-field-header">
        {showLabel ? (
          <div className="coaching-studio-field-title-row">
            <Form.Label className="coaching-studio-field-label">{label}</Form.Label>
          </div>
        ) : null}
        <FieldDescription description={description} helpText={metadata?.help} />
      </div>
      <div className="coaching-studio-field-control">
        <Form.Control
          className="coaching-studio-input coaching-studio-textarea"
          as="textarea"
          rows={rows || 8}
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange(event.target.value);
          }}
        />
      </div>
      {counter ? <p className="coaching-studio-field-counter">{counter}</p> : null}
      <FieldErrors errors={errors} />
    </Form.Group>
  );
}

function SelectField({
  description,
  errors,
  fieldName,
  metadata,
  onChange,
  value,
}: {
  description?: string;
  errors?: string[];
  fieldName: string;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: string) => void;
  value: string;
}) {
  const choices = Array.isArray(metadata?.choices) ? metadata?.choices : [];
  const label = getFieldLabel(metadata, fieldName);

  return (
    <Form.Group className="coaching-studio-field" isInvalid={Boolean(errors?.length)}>
      <div className="coaching-studio-field-header">
        <div className="coaching-studio-field-title-row">
          <Form.Label className="coaching-studio-field-label">{label}</Form.Label>
        </div>
        <FieldDescription description={description} helpText={metadata?.help} />
      </div>
      <div className="coaching-studio-field-control">
        <Form.Control
          className="coaching-studio-input"
          as="select"
          value={value}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
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
        </Form.Control>
      </div>
      <FieldErrors errors={errors} />
    </Form.Group>
  );
}

function BooleanChoiceField({
  description,
  errors,
  fieldName,
  metadata,
  onChange,
  value,
}: {
  description?: string;
  errors?: string[];
  fieldName: string;
  metadata?: StudioFieldMetadata;
  onChange: (nextValue: boolean) => void;
  value: boolean;
}) {
  const label = getFieldLabel(metadata, fieldName);

  return (
    <Form.Group className="coaching-studio-field" isInvalid={Boolean(errors?.length)}>
      <div className="coaching-studio-field-header">
        <div className="coaching-studio-field-title-row">
          <Form.Label className="coaching-studio-field-label">{label}</Form.Label>
        </div>
        <FieldDescription description={description} helpText={metadata?.help} />
      </div>
      <div className="coaching-studio-field-control">
        <Form.RadioSet
          className="coaching-studio-radio-group"
          name={fieldName}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value === "true");
          }}
          value={String(value)}
          isInline
        >
          <Form.Radio value="true">Yes</Form.Radio>
          <Form.Radio value="false">No</Form.Radio>
        </Form.RadioSet>
      </div>
      <FieldErrors errors={errors} />
    </Form.Group>
  );
}

function ListField({
  addLabel,
  description,
  errors,
  fieldName,
  helpText,
  items,
  label,
  onAdd,
  onChangeItem,
  onRemoveItem,
  placeholder,
  showLabel = true,
}: {
  addLabel: string;
  description?: string;
  errors?: string[];
  fieldName: string;
  helpText?: string;
  items: CoachingListItem[];
  label: string;
  onAdd: () => void;
  onChangeItem: (index: number, nextValue: string) => void;
  onRemoveItem: (index: number) => void;
  placeholder?: string;
  showLabel?: boolean;
}) {
  const displayItems = items.length > 0 ? items : [{ value: "" }];

  return (
    <Form.Group className="coaching-studio-field" isInvalid={Boolean(errors?.length)}>
      <div className="coaching-studio-field-header">
        {showLabel ? (
          <div className="coaching-studio-field-title-row">
            <Form.Label className="coaching-studio-field-label">{label}</Form.Label>
          </div>
        ) : null}
        <FieldDescription description={description} helpText={helpText} />
      </div>
      <div className="coaching-studio-field-control">
        <div className="coaching-studio-list-field">
          <div className="coaching-studio-list-rows">
            {displayItems.map((item, index) => {
              const canRemove = items.length > 0;

              return (
                <div className="coaching-studio-list-row-group" key={fieldName + "-" + String(index)}>
                  <div className="coaching-studio-list-row">
                    <Form.Control
                      className="coaching-studio-input"
                      value={item.value}
                      placeholder={placeholder}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        onChangeItem(index, event.target.value);
                      }}
                    />
                    {canRemove ? (
                      <Button
                        className="coaching-studio-list-remove"
                        variant="link"
                        aria-label={`Remove ${label.toLowerCase()} ${String(index + 1)}`}
                        onClick={() => {
                          onRemoveItem(index);
                        }}
                      >
                        <span aria-hidden="true">×</span>
                      </Button>
                    ) : null}
                  </div>
                  <FieldErrors errors={item.error ? [item.error] : undefined} />
                </div>
              );
            })}
          </div>
          <Button
            className="coaching-studio-list-add"
            variant="link"
            onClick={onAdd}
          >
            {addLabel}
          </Button>
        </div>
      </div>
      <FieldErrors errors={errors} />
    </Form.Group>
  );
}

function SectionCard({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  title?: string;
}) {
  return (
    <section className="coaching-studio-card">
      {title ? (
        <div className="coaching-studio-card-header">
          <h3 className="coaching-studio-card-title">{title}</h3>
          {description ? <p className="coaching-studio-card-description">{description}</p> : null}
        </div>
      ) : null}
      <div className="coaching-studio-card-body">{children}</div>
    </section>
  );
}

function SectionFieldErrors({ errors }: { errors?: string[] }) {
  const intl = useIntl();

  if (!errors || errors.length === 0) {
    return null;
  }

  return (
    <Alert variant="danger">
      <p className="ai-eval-section-errors-title">
        {intl.formatMessage({
          id: "coaching.studio.sectionFieldErrors.title",
          defaultMessage: "This section has validation issues.",
        })}
      </p>
      <FieldErrors errors={errors} />
    </Alert>
  );
}

function SectionNav({
  activeSection,
  onSectionChange,
  validationErrors,
}: {
  activeSection: CoachingStudioSectionId;
  onSectionChange: (sectionId: CoachingStudioSectionId) => void;
  validationErrors: CoachingStudioValidationErrors;
}) {
  return (
    <nav className="coaching-studio-nav" aria-label="Coaching Studio sections">
      <ul className="coaching-studio-nav-list">
        {COACHING_STUDIO_SECTIONS.map((section) => {
          const errorCount = getSectionErrorCount(section.id, validationErrors);
          const isActive = section.id === activeSection;

          return (
            <li key={section.id} className="coaching-studio-nav-item">
              <button
                type="button"
                className={
                  "coaching-studio-nav-button" +
                  (isActive ? " is-active" : "") +
                  (errorCount > 0 ? " has-errors" : "")
                }
                onClick={() => {
                  onSectionChange(section.id);
                }}
              >
                <span className="coaching-studio-nav-text">{section.title}</span>
                {errorCount > 0 ? (
                  <span className="coaching-studio-nav-badge">{errorCount}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function GeneralSection({
  fieldMetadata,
  lockMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  lockMetadata?: CoachingStudioLockMetadata;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: CoachingStudioValidationErrors;
  values: CoachingStudioState;
}) {
  return (
    <div className="coaching-studio-section-stack">
      <SectionCard>
        <TextInputField
          fieldName="display_name"
          metadata={fieldMetadata.display_name}
          description="Name of the XBlock component in Studio."
          value={values.display_name || ""}
          errors={validationErrors.display_name}
          onChange={(nextValue) => {
            onChange("display_name", nextValue);
          }}
        />
        <SelectField
          fieldName="model"
          metadata={{
            ...fieldMetadata.model,
            display_name: "Model",
          }}
          description="Choose the LLM (Large Launguage Model)."
          value={values.model || ""}
          errors={validationErrors.model}
          onChange={(nextValue) => {
            onChange("model", nextValue);
          }}
        />
        <TextInputField
          fieldName="model_api_key"
          metadata={{
            ...fieldMetadata.model_api_key,
            display_name: "API Key",
          }}
          description="API key for the selected LLM. Leave blank if configured by your admin."
          value={values.model_api_key || ""}
          errors={validationErrors.model_api_key}
          locked={isModelApiKeyLocked(values, lockMetadata)}
          onChange={(nextValue) => {
            onChange("model_api_key", nextValue);
          }}
        />
        <TextInputField
          fieldName="model_api_url"
          metadata={{
            ...fieldMetadata.model_api_url,
            display_name: "API URL (optional)",
          }}
          description="Only needed for Llama (models that don't have an official provider). Leave blank if configured globally by your admin."
          value={values.model_api_url || ""}
          errors={validationErrors.model_api_url}
          onChange={(nextValue) => {
            onChange("model_api_url", nextValue);
          }}
        />
        <NumberField
          fieldName="max_attempts"
          metadata={{
            ...fieldMetadata.max_attempts,
            display_name: "Maximum Responses",
          }}
          description="Number of times a learner can submit a response."
          value={values.max_attempts}
          errors={validationErrors.max_attempts}
          onChange={(nextValue) => {
            onChange("max_attempts", nextValue);
          }}
        />
        <BooleanChoiceField
          fieldName="allow_reset"
          metadata={{
            ...fieldMetadata.allow_reset,
            display_name: "Activity Reset",
          }}
          description="Let learners reset the activity. Only the latest score counts."
          value={Boolean(values.allow_reset)}
          errors={validationErrors.allow_reset}
          onChange={(nextValue) => {
            onChange("allow_reset", nextValue);
          }}
        />
      </SectionCard>
    </div>
  );
}

function TaskDescriptionSection({
  fieldMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: CoachingStudioValidationErrors;
  values: CoachingStudioState;
}) {
  return (
    <div className="coaching-studio-section-stack">
      <SectionCard>
        <TextAreaField
          fieldName="intro_text"
          metadata={fieldMetadata.intro_text}
          value={values.intro_text || ""}
          errors={validationErrors.intro_text}
          rows={12}
          showLabel={false}
          onChange={(nextValue) => {
            onChange("intro_text", nextValue);
          }}
        />
      </SectionCard>
    </div>
  );
}

function TaskContextSection({
  fieldMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: CoachingStudioValidationErrors;
  values: CoachingStudioState;
}) {
  const scenario = getScenarioEditorModel(values.scenario_data);
  const learningObjectives = getScenarioListItems(values.scenario_data, "learning_objectives");

  return (
    <div className="coaching-studio-section-stack">
      <SectionFieldErrors errors={validationErrors.scenario_data} />
      <SectionCard
        title="Scenario"
        description="Tell the AI model briefly what the learner's task is."
      >
        <TextAreaField
          fieldName="scenario_case_details"
          metadata={{
            display_name: "Scenario",
          }}
          counter={`${scenario.caseDetails.length}/1000`}
          errors={validationErrors.scenario_case_details}
          value={scenario.caseDetails}
          rows={4}
          showLabel={false}
          onChange={(nextValue) => {
            onChange("scenario_data", updateScenarioDataValue(values.scenario_data, "case_details", nextValue));
          }}
        />
      </SectionCard>
      <SectionCard
        title="Learning Objectives"
        description="Tell the AI model what to look for in the learner's response. Use one explicit row per objective."
      >
        <ListField
          fieldName="scenario_learning_objectives"
          label="Learning Objectives"
          items={learningObjectives}
          errors={validationErrors.scenario_learning_objectives}
          addLabel="+ Add objective"
          placeholder="Describe one learning objective"
          showLabel={false}
          onAdd={() => {
            onChange(
              "scenario_data",
              updateScenarioListItems(
                values.scenario_data,
                "learning_objectives",
                appendListItem(learningObjectives),
              ),
            );
          }}
          onChangeItem={(index, nextValue) => {
            const nextItems =
              learningObjectives.length > 0
                ? updateListItemAtIndex(learningObjectives, index, nextValue)
                : [{ value: nextValue }];
            onChange(
              "scenario_data",
              updateScenarioListItems(values.scenario_data, "learning_objectives", nextItems),
            );
          }}
          onRemoveItem={(index) => {
            onChange(
              "scenario_data",
              updateScenarioListItems(
                values.scenario_data,
                "learning_objectives",
                removeListItemAtIndex(learningObjectives, index),
              ),
            );
          }}
        />
      </SectionCard>
    </div>
  );
}

function EvaluationSection({
  fieldMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: CoachingStudioValidationErrors;
  values: CoachingStudioState;
}) {
  const evaluationCriteria = getScenarioListItems(values.scenario_data, "evaluation_criteria");

  return (
    <div className="coaching-studio-section-stack">
      <SectionCard
        title="Evaluation Criteria"
        description="Tell the AI model what criteria to use when evaluating the learner's response. Add one criterion per row."
      >
        <ListField
          fieldName="scenario_evaluation_criteria"
          label="Evaluation Criteria"
          items={evaluationCriteria}
          errors={validationErrors.scenario_evaluation_criteria}
          addLabel="+ Add criterion"
          placeholder="Name one evaluation criterion"
          showLabel={false}
          onAdd={() => {
            onChange(
              "scenario_data",
              updateScenarioListItems(
                values.scenario_data,
                "evaluation_criteria",
                appendListItem(evaluationCriteria),
              ),
            );
          }}
          onChangeItem={(index, nextValue) => {
            const nextItems =
              evaluationCriteria.length > 0
                ? updateListItemAtIndex(evaluationCriteria, index, nextValue)
                : [{ value: nextValue }];
            onChange(
              "scenario_data",
              updateScenarioListItems(values.scenario_data, "evaluation_criteria", nextItems),
            );
          }}
          onRemoveItem={(index) => {
            onChange(
              "scenario_data",
              updateScenarioListItems(
                values.scenario_data,
                "evaluation_criteria",
                removeListItemAtIndex(evaluationCriteria, index),
              ),
            );
          }}
        />
      </SectionCard>
      <SectionCard
        title="Evaluator Prompt"
        description="Instructions sent to the AI model to guide how learner responses are evaluated."
      >
        <TextAreaField
          fieldName="evaluator_prompt"
          metadata={fieldMetadata.evaluator_prompt}
          value={values.evaluator_prompt || ""}
          errors={validationErrors.evaluator_prompt}
          rows={12}
          showLabel={false}
          onChange={(nextValue) => {
            onChange("evaluator_prompt", nextValue);
          }}
        />
      </SectionCard>
    </div>
  );
}

function WorkspaceSection({
  fieldMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: CoachingStudioValidationErrors;
  values: CoachingStudioState;
}) {
  return (
    <div className="coaching-studio-section-stack">
      <SectionCard>
        <TextInputField
          fieldName="workspace_title"
          metadata={{
            ...fieldMetadata.workspace_title,
            display_name: "Title",
          }}
          description="Heading above the workspace."
          value={values.workspace_title || ""}
          errors={validationErrors.workspace_title}
          onChange={(nextValue) => {
            onChange("workspace_title", nextValue);
          }}
        />
        <TextInputField
          fieldName="character_1_name"
          metadata={{
            ...fieldMetadata.character_1_name,
            display_name: "Persona Name",
          }}
          description="Learner interacts with this persona in the workspace."
          value={values.character_1_name || ""}
          errors={validationErrors.character_1_name}
          onChange={(nextValue) => {
            onChange("character_1_name", nextValue);
          }}
        />
        <TextInputField
          fieldName="character_1_role"
          metadata={{
            ...fieldMetadata.character_1_role,
            display_name: "Persona Role",
          }}
          description="Tell the AI model what role the persona should play."
          counter={`${(values.character_1_role || "").length}/30`}
          value={values.character_1_role || ""}
          errors={validationErrors.character_1_role}
          onChange={(nextValue) => {
            onChange("character_1_role", nextValue);
          }}
        />
        <TextInputField
          fieldName="character_1_avatar"
          metadata={{
            ...fieldMetadata.character_1_avatar,
            display_name: "Persona Avatar URL",
          }}
          description="Optional image shown next to the persona's chat messages."
          value={values.character_1_avatar || ""}
          errors={validationErrors.character_1_avatar}
          onChange={(nextValue) => {
            onChange("character_1_avatar", nextValue);
          }}
        />
      </SectionCard>
      <SectionCard>
        <TextAreaField
          fieldName="initial_message"
          metadata={{
            ...fieldMetadata.initial_message,
            display_name: "Conversation Starter",
          }}
          description="Persona's first message in the workspace."
          value={values.initial_message || ""}
          errors={validationErrors.initial_message}
          rows={5}
          onChange={(nextValue) => {
            onChange("initial_message", nextValue);
          }}
        />
      </SectionCard>
      <SectionCard>
        <TextAreaField
          fieldName="character_1_prompt"
          metadata={{
            ...fieldMetadata.character_1_prompt,
            display_name: "Persona Prompt",
          }}
          description="Instructions that define the persona's role, personality and perspective. This text shapes how the AI model responds."
          value={values.character_1_prompt || ""}
          errors={validationErrors.character_1_prompt}
          rows={16}
          onChange={(nextValue) => {
            onChange("character_1_prompt", nextValue);
          }}
        />
      </SectionCard>
    </div>
  );
}

function CoachChatSection({
  fieldMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: CoachingStudioValidationErrors;
  values: CoachingStudioState;
}) {
  return (
    <div className="coaching-studio-section-stack">
      <SectionCard>
        <TextInputField
          fieldName="coach_title"
          metadata={{
            ...fieldMetadata.coach_title,
            display_name: "Title",
          }}
          description="Heading above the coach chat."
          value={values.coach_title || ""}
          errors={validationErrors.coach_title}
          onChange={(nextValue) => {
            onChange("coach_title", nextValue);
          }}
        />
        <TextInputField
          fieldName="character_2_name"
          metadata={{
            ...fieldMetadata.character_2_name,
            display_name: "Coach Name",
          }}
          description="Learner interacts with this coach in the coach chat."
          value={values.character_2_name || ""}
          errors={validationErrors.character_2_name}
          onChange={(nextValue) => {
            onChange("character_2_name", nextValue);
          }}
        />
        <TextInputField
          fieldName="character_2_role"
          metadata={{
            ...fieldMetadata.character_2_role,
            display_name: "Coach Role",
          }}
          description="Tell the AI model what role the coach should play."
          counter={`${(values.character_2_role || "").length}/30`}
          value={values.character_2_role || ""}
          errors={validationErrors.character_2_role}
          onChange={(nextValue) => {
            onChange("character_2_role", nextValue);
          }}
        />
        <TextInputField
          fieldName="character_2_avatar"
          metadata={{
            ...fieldMetadata.character_2_avatar,
            display_name: "Coach Avatar URL",
          }}
          description="Optional image shown next to the coach's chat messages."
          value={values.character_2_avatar || ""}
          errors={validationErrors.character_2_avatar}
          onChange={(nextValue) => {
            onChange("character_2_avatar", nextValue);
          }}
        />
      </SectionCard>
      <SectionCard>
        <TextAreaField
          fieldName="coach_initial_message"
          metadata={{
            ...fieldMetadata.coach_initial_message,
            display_name: "Conversation Starter",
          }}
          description="Coach's first message."
          value={values.coach_initial_message || ""}
          errors={validationErrors.coach_initial_message}
          rows={5}
          onChange={(nextValue) => {
            onChange("coach_initial_message", nextValue);
          }}
        />
      </SectionCard>
      <SectionCard>
        <TextAreaField
          fieldName="character_2_prompt"
          metadata={{
            ...fieldMetadata.character_2_prompt,
            display_name: "Coach Prompt",
          }}
          description="Instructions that define the coach's role, personality and perspective. This text shapes how the AI model responds."
          value={values.character_2_prompt || ""}
          errors={validationErrors.character_2_prompt}
          rows={16}
          onChange={(nextValue) => {
            onChange("character_2_prompt", nextValue);
          }}
        />
      </SectionCard>
    </div>
  );
}

function AdvancedSection({
  fieldMetadata,
  onChange,
  validationErrors,
  values,
}: {
  fieldMetadata: Record<string, StudioFieldMetadata>;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: CoachingStudioValidationErrors;
  values: CoachingStudioState;
}) {
  const blacklistItems = getBlacklistItems(values.blacklist);

  return (
    <div className="coaching-studio-section-stack">
      <SectionCard>
        <ListField
          fieldName="blacklist"
          label="Language to Avoid (optional)"
          description="Words or phrases the AI model must not use in any responses."
          items={blacklistItems}
          errors={validationErrors.blacklist}
          addLabel="+ Add blocked phrase"
          placeholder="Blocked word or phrase"
          onAdd={() => {
            onChange("blacklist", updateBlacklistItems(appendListItem(blacklistItems)));
          }}
          onChangeItem={(index, nextValue) => {
            const nextItems =
              blacklistItems.length > 0
                ? updateListItemAtIndex(blacklistItems, index, nextValue)
                : [{ value: nextValue }];
            onChange("blacklist", updateBlacklistItems(nextItems));
          }}
          onRemoveItem={(index) => {
            onChange(
              "blacklist",
              updateBlacklistItems(removeListItemAtIndex(blacklistItems, index)),
            );
          }}
        />
      </SectionCard>
    </div>
  );
}

function SectionPanel({
  activeSection,
  fieldMetadata,
  lockMetadata,
  onChange,
  validationErrors,
  values,
}: {
  activeSection: CoachingStudioSectionId;
  fieldMetadata: Record<string, StudioFieldMetadata>;
  lockMetadata?: CoachingStudioLockMetadata;
  onChange: (fieldName: string, nextValue: unknown) => void;
  validationErrors: CoachingStudioValidationErrors;
  values: CoachingStudioState;
}) {
  const activeSectionMeta = COACHING_STUDIO_SECTIONS.find((section) => section.id === activeSection);

  return (
    <div className="coaching-studio-panel" data-section-id={activeSection}>
      <div className="coaching-studio-panel-header">
        <h2 className="coaching-studio-panel-title">{activeSectionMeta?.title}</h2>
        <p className="coaching-studio-panel-description">{activeSectionMeta?.description}</p>
      </div>
      {activeSection === "general" ? (
        <GeneralSection
          fieldMetadata={fieldMetadata}
          lockMetadata={lockMetadata}
          onChange={onChange}
          validationErrors={validationErrors}
          values={values}
        />
      ) : null}
      {activeSection === "taskDescription" ? (
        <TaskDescriptionSection
          fieldMetadata={fieldMetadata}
          onChange={onChange}
          validationErrors={validationErrors}
          values={values}
        />
      ) : null}
      {activeSection === "taskContext" ? (
        <TaskContextSection
          fieldMetadata={fieldMetadata}
          onChange={onChange}
          validationErrors={validationErrors}
          values={values}
        />
      ) : null}
      {activeSection === "evaluation" ? (
        <EvaluationSection
          fieldMetadata={fieldMetadata}
          onChange={onChange}
          validationErrors={validationErrors}
          values={values}
        />
      ) : null}
      {activeSection === "workspace" ? (
        <WorkspaceSection
          fieldMetadata={fieldMetadata}
          onChange={onChange}
          validationErrors={validationErrors}
          values={values}
        />
      ) : null}
      {activeSection === "coachChat" ? (
        <CoachChatSection
          fieldMetadata={fieldMetadata}
          onChange={onChange}
          validationErrors={validationErrors}
          values={values}
        />
      ) : null}
      {activeSection === "advanced" ? (
        <AdvancedSection
          fieldMetadata={fieldMetadata}
          onChange={onChange}
          validationErrors={validationErrors}
          values={values}
        />
      ) : null}
    </div>
  );
}

function CoachingStudioFormContent({
  payload,
  runtime,
}: {
  payload: CoachingStudioPayload;
  runtime?: XBlockRuntime;
}) {
  const formik = useFormikContext<CoachingStudioState>();
  const intl = useIntl();
  const [activeSection, setActiveSection] = useState<CoachingStudioSectionId>("general");
  const [validationErrors, setValidationErrors] = useState<CoachingStudioValidationErrors>({});
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [requestError, setRequestError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const meta: CoachingStudioMeta = payload.meta || {};
  const fieldMetadata = meta.field_metadata || {};
  const lockMetadata = meta.lock_metadata;

  useEffect(() => {
    setActiveSection("general");
    setValidationErrors({});
    setValidationWarnings([]);
    setRequestError("");
  }, [payload.initial_state]);

  function handleValidationResponse(
    nextValidationErrors: CoachingStudioValidationErrors,
    preferredSectionId?: CoachingStudioSectionId,
  ) {
    setValidationErrors(nextValidationErrors);

    const nextSection = getFirstSectionWithErrors(nextValidationErrors, preferredSectionId);
    if (nextSection) {
      setActiveSection(nextSection);
    }
  }

  async function saveStudioSettings() {
    if (!payload.handler_urls.studio_submit || isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;

    const savingMessage = intl.formatMessage({
      id: "coaching.studio.saving",
      defaultMessage: "Saving",
    });
    const validationMessage = intl.formatMessage({
      id: "coaching.studio.validationError",
      defaultMessage: "Please fix the validation issues and try again.",
    });
    const sanitizedBlacklist = sanitizeBlacklistValue(formik.values.blacklist);
    const sanitizedValues = {
      ...formik.values,
      blacklist: sanitizedBlacklist,
    };
    if (sanitizedBlacklist.length !== formik.values.blacklist?.length) {
      formik.setFieldValue("blacklist", sanitizedBlacklist);
    }

    let yupErrors: CoachingStudioValidationErrors = {};
    try {
      await coachingSchema.validate(sanitizedValues, { abortEarly: false });
    } catch (error: unknown) {
      if (error instanceof Yup.ValidationError) {
        yupErrors = collectYupErrors(error);
      }
    }

    const frontendValidationErrors = {
      ...yupErrors,
      ...buildFrontendValidationErrors(sanitizedValues),
    };

    if (Object.keys(frontendValidationErrors).length > 0) {
      setRequestError(validationMessage);
      setValidationWarnings([]);
      handleValidationResponse(frontendValidationErrors, activeSection);
      notifyRuntime(runtime, "error", {
        title: intl.formatMessage({
          id: "coaching.studio.saveFailed",
          defaultMessage: "Unable to update settings",
        }),
        message: validationMessage,
      });
      isSavingRef.current = false;
      return;
    }

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
        buildSubmitPayload(sanitizedValues),
      );

      const nextValidationErrors = normalizeValidationErrors(response.validation_errors);
      setValidationWarnings(normalizeValidationWarnings(response.validation_warnings));
      handleValidationResponse(nextValidationErrors, activeSection);
      isSavingRef.current = false;
      setIsSaving(false);

      if (response.success) {
        notifyRuntime(runtime, "save", { state: "end" });
      } else {
        setRequestError(validationMessage);
        notifyRuntime(runtime, "error", {
          title: intl.formatMessage({
            id: "coaching.studio.saveFailed",
            defaultMessage: "Unable to update settings",
          }),
          message: validationMessage,
        });
      }
    } catch (error: unknown) {
      let inlineRequestError = "";

      if (error instanceof RequestError && error.payload) {
        const normalizedResponse = normalizeStudioSaveResponse(error.payload);
        const nextValidationErrors = normalizeValidationErrors(normalizedResponse.validation_errors);
        handleValidationResponse(nextValidationErrors, activeSection);
        setValidationWarnings(normalizeValidationWarnings(normalizedResponse.validation_warnings));
        if (Object.keys(normalizedResponse.validation_errors).length > 0) {
          inlineRequestError = validationMessage;
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
      isSavingRef.current = false;
      setIsSaving(false);
      notifyRuntime(runtime, "error", {
        title: intl.formatMessage({
          id: "coaching.studio.saveFailed",
          defaultMessage: "Unable to update settings",
        }),
        message: inlineRequestError,
      });
    }
  }

  function handleCancel() {
    if (isSavingRef.current) {
      return;
    }

    notifyRuntime(runtime, "cancel", {});
  }

  return (
    <div
      className="shortanswer-react-studio coaching-react-studio"
      data-block-kind="coaching"
    >
      <StudioEditorLayout
        i18nPrefix="coaching"
        isSaving={isSaving}
        onCancel={handleCancel}
        onSave={saveStudioSettings}
      >
        <div className="wrapper-comp-settings is-active" id="settings-tab">
          <div className="coaching-studio-shell">
            <StudioValidationSummary
              requestError={requestError}
              validationWarnings={validationWarnings}
            />

            <div className="coaching-studio-body">
              <SectionNav
                activeSection={activeSection}
                onSectionChange={setActiveSection}
                validationErrors={validationErrors}
              />
              <SectionPanel
                activeSection={activeSection}
                fieldMetadata={fieldMetadata}
                lockMetadata={lockMetadata}
                onChange={(fieldName, nextValue) => {
                  formik.setFieldValue(fieldName, nextValue);
                }}
                validationErrors={validationErrors}
                values={formik.values}
              />
            </div>
          </div>
        </div>
      </StudioEditorLayout>
    </div>
  );
}

export default function CoachingStudioApp({
  payload,
  runtime,
}: {
  payload: CoachingStudioPayload;
  runtime?: XBlockRuntime;
}) {
  const initialValues = useMemo(
    () =>
      coachingSchema.cast(payload.initial_state, {
        stripUnknown: true,
      }) as CoachingStudioState,
    [payload.initial_state],
  );

  return (
    <Formik<CoachingStudioState>
      initialValues={initialValues}
      enableReinitialize
      onSubmit={() => {}}
    >
      <CoachingStudioFormContent payload={payload} runtime={runtime} />
    </Formik>
  );
}
