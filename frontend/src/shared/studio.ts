import { postJson } from "./request";
import { UnknownRecord } from "./types";

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
