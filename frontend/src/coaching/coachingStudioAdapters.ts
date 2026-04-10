import { EvaluationCriterion, ScenarioData } from "./types";

export interface CoachingScenarioEditorModel {
  caseDetails: string;
}

export interface CoachingListItem {
  error?: string;
  preserveRawValue?: boolean;
  rawValue?: unknown;
  value: string;
}

function formatEditorValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || typeof value === "undefined") {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return "";
  }
}

function createValidListItem(value: string): CoachingListItem {
  return { value };
}

function createInvalidListItem(rawValue: unknown, error: string): CoachingListItem {
  return {
    error,
    preserveRawValue: true,
    rawValue,
    value: formatEditorValue(rawValue),
  };
}

function getStringListItems(
  values: string[] | undefined,
  invalidEntryMessage: string,
): CoachingListItem[] {
  if (!values) {
    return [];
  }

  return (values as unknown[]).map((value) => {
    if (typeof value === "string") {
      return createValidListItem(value);
    }

    return createInvalidListItem(value, invalidEntryMessage);
  });
}

function getEvaluationCriteriaItems(
  values: EvaluationCriterion[] | undefined,
): CoachingListItem[] {
  if (!values) {
    return [];
  }

  return (values as unknown[]).map((value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const criterion = value as Record<string, unknown>;
      if (typeof criterion.name === "string") {
        return createValidListItem(criterion.name);
      }

      if (Object.prototype.hasOwnProperty.call(criterion, "name")) {
        return createInvalidListItem(value, "Saved criterion name must be text.");
      }

      return createInvalidListItem(value, "Saved criterion must include a name.");
    }

    return createInvalidListItem(value, "Saved criterion must be an object with a name.");
  });
}

export function getScenarioEditorModel(
  scenarioData: ScenarioData | undefined,
): CoachingScenarioEditorModel {
  return {
    caseDetails: scenarioData?.case_details ?? "",
  };
}

export function getScenarioListItems(
  scenarioData: ScenarioData | undefined,
  fieldName: "learning_objectives" | "evaluation_criteria",
): CoachingListItem[] {
  if (fieldName === "learning_objectives") {
    return getStringListItems(
      scenarioData?.learning_objectives,
      "Saved learning objective must be text.",
    );
  }

  return getEvaluationCriteriaItems(scenarioData?.evaluation_criteria);
}

export const emptyScenarioData: ScenarioData = { case_details: "", evaluation_criteria: [], learning_objectives: [] };

export function updateScenarioDataValue(
  scenarioData: ScenarioData | undefined,
  fieldName: "case_details",
  nextValue: string,
): ScenarioData {
  return { ...(scenarioData || emptyScenarioData), case_details: nextValue };
}

export function updateScenarioListItems(
  scenarioData: ScenarioData | undefined,
  fieldName: "learning_objectives" | "evaluation_criteria",
  nextItems: CoachingListItem[],
): ScenarioData {
  if (fieldName === "learning_objectives") {
    return {
      ...(scenarioData || emptyScenarioData),
      learning_objectives: nextItems.map((item) => {
        return (item.preserveRawValue ? item.rawValue : item.value) as string;
      }),
    };
  }

  return {
    ...(scenarioData || emptyScenarioData),
    evaluation_criteria: nextItems.map((item) => {
      if (item.preserveRawValue) {
        return item.rawValue as EvaluationCriterion;
      }

      return { name: item.value };
    }),
  };
}

export function getBlacklistItems(blacklist: string[] | undefined): CoachingListItem[] {
  if (!blacklist) {
    return [];
  }

  return (blacklist as unknown[]).map((value) => {
    if (typeof value === "string") {
      return createValidListItem(value);
    }

    return createInvalidListItem(value, "Saved blocked phrase must be text.");
  });
}

export function updateBlacklistItems(nextItems: CoachingListItem[]): string[] {
  return nextItems.map((item) => {
    return (item.preserveRawValue ? item.rawValue : item.value) as string;
  });
}

export function sanitizeBlacklistValue(blacklist: string[] | undefined): string[] {
  if (!blacklist) {
    return [];
  }

  return (blacklist as unknown[]).filter((value): value is string => {
    return typeof value === "string" && value.trim() !== "";
  });
}
