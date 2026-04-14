import { postJson, RequestError } from "./request";
import { UnknownRecord } from "./types";

export type ValidationErrors = Record<string, string[]>;

export interface StudioSaveResponse {
  success: boolean;
  validation_errors: UnknownRecord;
  validation_warnings: unknown[];
  meta: UnknownRecord;
}

type PartialStudioSaveResponse = Partial<StudioSaveResponse> & UnknownRecord;

function toStudioResponse(response: unknown): PartialStudioSaveResponse {
  if (response && typeof response === "object") {
    return response as PartialStudioSaveResponse;
  }

  return {};
}

export function normalizeStudioSaveResponse(response: unknown): StudioSaveResponse {
  const normalized = toStudioResponse(response);

  return {
    success: Boolean(normalized.success),
    validation_errors: normalized.validation_errors || {},
    validation_warnings: normalized.validation_warnings || [],
    meta: normalized.meta || {},
  };
}

export function submitStudioPayload(url: string, payload: unknown) {
  return postJson<PartialStudioSaveResponse>(url, payload).then((response) => {
    return normalizeStudioSaveResponse(response);
  });
}

export function hasStudioValidationIssues(response: unknown) {
  const normalized = normalizeStudioSaveResponse(response);

  return (
    Object.keys(normalized.validation_errors).length > 0 ||
    normalized.validation_warnings.length > 0
  );
}

export function normalizeValidationWarnings(rawWarnings: unknown): string[] {
  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  return rawWarnings.filter((warning): warning is string => typeof warning === "string");
}

export function normalizeValidationErrors(rawErrors: unknown): ValidationErrors {
  if (!rawErrors || typeof rawErrors !== "object") {
    return {};
  }

  const validationErrors = rawErrors as Record<string, unknown>;

  return Object.keys(validationErrors).reduce<ValidationErrors>((errors, fieldName) => {
    const fieldErrors = validationErrors[fieldName];

    if (Array.isArray(fieldErrors)) {
      errors[fieldName] = fieldErrors.filter(
        (entry): entry is string => typeof entry === "string",
      );
    } else if (typeof fieldErrors === "string" && fieldErrors) {
      errors[fieldName] = [fieldErrors];
    }

    return errors;
  }, {});
}

export function collectYupErrors(
  error: { inner: Array<{ path?: string; message: string }> },
): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const err of error.inner) {
    if (err.path) {
      if (!errors[err.path]) {
        errors[err.path] = [];
      }
      errors[err.path].push(err.message);
    }
  }
  return errors;
}

export function getSaveErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof RequestError && error.payload) {
    if (hasStudioValidationIssues(error.payload)) {
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

export function isModelApiKeyLocked(
  values: { model?: string },
  lockMetadata?: {
    initial_model?: string;
    lock_model_api_key_initial?: boolean;
    model_key_presence?: Record<string, boolean>;
    use_custom_llm_service?: boolean;
  },
) {
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

export function notifyRuntime(
  runtime: { notify?(name: string, payload?: UnknownRecord): void } | undefined,
  name: string,
  payload?: UnknownRecord,
) {
  if (runtime && typeof runtime.notify === "function") {
    runtime.notify(name, payload);
  }
}
