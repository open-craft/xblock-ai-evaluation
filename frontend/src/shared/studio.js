import { postJson } from "./request";

export function normalizeStudioSaveResponse(response) {
  return {
    success: Boolean(response && response.success),
    validation_errors: (response && response.validation_errors) || {},
    validation_warnings: (response && response.validation_warnings) || [],
    meta: (response && response.meta) || {},
  };
}

export function submitStudioPayload(url, payload) {
  return postJson(url, payload).then(function handleResponse(response) {
    return normalizeStudioSaveResponse(response);
  });
}

export function hasStudioValidationIssues(response) {
  var normalized = normalizeStudioSaveResponse(response);

  return (
    Object.keys(normalized.validation_errors).length > 0 ||
    normalized.validation_warnings.length > 0
  );
}
