import { RequestError } from "./request";
import {
  collectYupErrors,
  getSaveErrorMessage,
  hasStudioValidationIssues,
  isModelApiKeyLocked,
  normalizeStudioSaveResponse,
  normalizeValidationErrors,
  normalizeValidationWarnings,
  notifyRuntime,
} from "./studio";

describe("normalizeStudioSaveResponse", () => {
  it("normalizes a valid response", () => {
    const response = {
      success: true,
      validation_errors: { field: ["error"] },
      validation_warnings: ["warning"],
      meta: { key: "value" },
    };
    expect(normalizeStudioSaveResponse(response)).toEqual(response);
  });

  it("handles null input", () => {
    expect(normalizeStudioSaveResponse(null)).toEqual({
      success: false,
      validation_errors: {},
      validation_warnings: [],
      meta: {},
    });
  });

  it("handles undefined input", () => {
    expect(normalizeStudioSaveResponse(undefined)).toEqual({
      success: false,
      validation_errors: {},
      validation_warnings: [],
      meta: {},
    });
  });

  it("defaults missing fields to empty values", () => {
    expect(normalizeStudioSaveResponse({})).toEqual({
      success: false,
      validation_errors: {},
      validation_warnings: [],
      meta: {},
    });
  });
});

describe("hasStudioValidationIssues", () => {
  it("returns true when validation_errors is non-empty", () => {
    expect(hasStudioValidationIssues({
      validation_errors: { field: ["error"] },
      validation_warnings: [],
    })).toBe(true);
  });

  it("returns true when validation_warnings is non-empty", () => {
    expect(hasStudioValidationIssues({
      validation_errors: {},
      validation_warnings: ["warning"],
    })).toBe(true);
  });

  it("returns false when both are empty", () => {
    expect(hasStudioValidationIssues({
      validation_errors: {},
      validation_warnings: [],
    })).toBe(false);
  });
});

describe("normalizeValidationWarnings", () => {
  it("filters non-string entries", () => {
    expect(normalizeValidationWarnings(["valid", 42, null, "also valid"])).toEqual([
      "valid",
      "also valid",
    ]);
  });

  it("returns empty array for non-array input", () => {
    expect(normalizeValidationWarnings(null)).toEqual([]);
    expect(normalizeValidationWarnings("string")).toEqual([]);
    expect(normalizeValidationWarnings({})).toEqual([]);
  });
});

describe("normalizeValidationErrors", () => {
  it("normalizes array field errors", () => {
    expect(normalizeValidationErrors({ field: ["error1", "error2"] })).toEqual({
      field: ["error1", "error2"],
    });
  });

  it("wraps string field errors in arrays", () => {
    expect(normalizeValidationErrors({ field: "single error" })).toEqual({
      field: ["single error"],
    });
  });

  it("filters non-string entries from arrays", () => {
    expect(normalizeValidationErrors({ field: ["valid", 42, null] })).toEqual({
      field: ["valid"],
    });
  });

  it("returns empty object for non-object input", () => {
    expect(normalizeValidationErrors(null)).toEqual({});
    expect(normalizeValidationErrors(undefined)).toEqual({});
    expect(normalizeValidationErrors("string")).toEqual({});
  });
});

describe("collectYupErrors", () => {
  it("groups errors by field path", () => {
    const error = {
      inner: [
        { path: "name", message: "required" },
        { path: "name", message: "too short" },
        { path: "email", message: "invalid" },
      ],
    };
    expect(collectYupErrors(error)).toEqual({
      name: ["required", "too short"],
      email: ["invalid"],
    });
  });

  it("skips errors without a path", () => {
    const error = {
      inner: [
        { path: "name", message: "required" },
        { path: undefined, message: "general error" },
      ],
    };
    expect(collectYupErrors(error)).toEqual({
      name: ["required"],
    });
  });
});

describe("getSaveErrorMessage", () => {
  it("returns error message for RequestError with validation issues", () => {
    const error = new RequestError("Validation failed", 400, {
      validation_errors: { field: ["error"] },
      validation_warnings: [],
    });
    expect(getSaveErrorMessage(error, "fallback")).toBe("Validation failed");
  });

  it("delegates to getErrorMessage for non-validation errors", () => {
    const error = new Error("network error");
    expect(getSaveErrorMessage(error, "fallback")).toBe("network error");
  });

  it("returns fallback for non-Error values", () => {
    expect(getSaveErrorMessage("string", "fallback")).toBe("fallback");
  });
});

describe("isModelApiKeyLocked", () => {
  it("returns true when custom LLM service is enabled", () => {
    expect(isModelApiKeyLocked({}, { use_custom_llm_service: true })).toBe(true);
  });

  it("checks model_key_presence map for current model", () => {
    expect(isModelApiKeyLocked(
      { model: "gpt-4o" },
      { model_key_presence: { "gpt-4o": true } },
    )).toBe(true);

    expect(isModelApiKeyLocked(
      { model: "gpt-4o" },
      { model_key_presence: { "gpt-4o": false } },
    )).toBe(false);
  });

  it("falls back to lock_model_api_key_initial", () => {
    expect(isModelApiKeyLocked(
      { model: "unknown-model" },
      { lock_model_api_key_initial: true },
    )).toBe(true);
  });

  it("uses initial_model when model is empty", () => {
    expect(isModelApiKeyLocked(
      {},
      { initial_model: "gpt-4o", model_key_presence: { "gpt-4o": true } },
    )).toBe(true);
  });
});

describe("notifyRuntime", () => {
  it("calls runtime.notify when available", () => {
    const notify = jest.fn();
    notifyRuntime({ notify }, "save", { key: "value" });
    expect(notify).toHaveBeenCalledWith("save", { key: "value" });
  });

  it("does nothing when runtime is undefined", () => {
    expect(() => notifyRuntime(undefined, "save")).not.toThrow();
  });

  it("does nothing when notify is not a function", () => {
    expect(() => notifyRuntime({} as any, "save")).not.toThrow();
  });
});
