type JsonObject = Record<string, unknown>;

export interface CoachingScenarioEditorModel {
  caseDetails: string;
}

export interface CoachingListItem {
  error?: string;
  preserveRawValue?: boolean;
  rawValue?: unknown;
  value: string;
}

function parseJsonValue(rawValue: unknown, fallback: unknown) {
  if (typeof rawValue !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return fallback;
  }
}

function asJsonObject(rawValue: unknown): JsonObject {
  const parsedValue =
    typeof rawValue === "string" ? parseJsonValue(rawValue, {}) : rawValue;

  if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
    return parsedValue as JsonObject;
  }

  return {};
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

function getStringListItems(values: unknown, invalidEntryMessage: string): CoachingListItem[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value) => {
    if (typeof value === "string") {
      return createValidListItem(value);
    }

    return createInvalidListItem(value, invalidEntryMessage);
  });
}

function getEvaluationCriteriaItems(values: unknown): CoachingListItem[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const criterion = value as JsonObject;
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

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function getScenarioEditorModel(rawScenarioData: unknown): CoachingScenarioEditorModel {
  const scenarioData = asJsonObject(rawScenarioData);

  return {
    caseDetails:
      typeof scenarioData.case_details === "string" ? scenarioData.case_details : "",
  };
}

export function getScenarioListItems(
  rawScenarioData: unknown,
  fieldName: "learning_objectives" | "evaluation_criteria",
): CoachingListItem[] {
  const scenarioData = asJsonObject(rawScenarioData);

  if (fieldName === "learning_objectives") {
    return getStringListItems(
      scenarioData.learning_objectives,
      "Saved learning objective must be text.",
    );
  }

  return getEvaluationCriteriaItems(scenarioData.evaluation_criteria);
}

export function updateScenarioDataValue(
  rawScenarioData: unknown,
  fieldName: "case_details",
  nextValue: string,
) {
  const scenarioData = {
    ...asJsonObject(rawScenarioData),
  };

  scenarioData.case_details = nextValue;

  return stringifyJson(scenarioData);
}

export function updateScenarioListItems(
  rawScenarioData: unknown,
  fieldName: "learning_objectives" | "evaluation_criteria",
  nextItems: CoachingListItem[],
) {
  const scenarioData = {
    ...asJsonObject(rawScenarioData),
  };

  if (fieldName === "learning_objectives") {
    scenarioData.learning_objectives = nextItems.map((item) => {
      return item.preserveRawValue ? item.rawValue : item.value;
    });
  } else {
    scenarioData.evaluation_criteria = nextItems.map((item) => {
      if (item.preserveRawValue) {
        return item.rawValue;
      }

      return { name: item.value };
    });
  }

  return stringifyJson(scenarioData);
}

export function getBlacklistItems(rawBlacklist: unknown): CoachingListItem[] {
  const parsedValue =
    typeof rawBlacklist === "string" ? parseJsonValue(rawBlacklist, []) : rawBlacklist;

  if (!Array.isArray(parsedValue)) {
    return [];
  }

  return parsedValue.map((value) => {
    if (typeof value === "string") {
      return createValidListItem(value);
    }

    return createInvalidListItem(value, "Saved blocked phrase must be text.");
  });
}

export function updateBlacklistItems(rawBlacklist: unknown, nextItems: CoachingListItem[]) {
  void rawBlacklist;
  return stringifyJson(nextItems.map((item) => {
    return item.preserveRawValue ? item.rawValue : item.value;
  }));
}

export function sanitizeBlacklistValue(rawBlacklist: unknown) {
  const parsedValue =
    typeof rawBlacklist === "string" ? parseJsonValue(rawBlacklist, []) : rawBlacklist;

  if (!Array.isArray(parsedValue)) {
    return "[]";
  }

  return stringifyJson(parsedValue.filter((value) => {
    return !(typeof value === "string" && value.trim() === "");
  }));
}
