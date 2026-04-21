import React from "react";
import { useIntl } from "react-intl";
import { Alert } from "@openedx/paragon";

export function StudioValidationSummary({
  hasFieldErrors,
  requestError,
  validationWarnings,
}: {
  hasFieldErrors?: boolean;
  requestError: string;
  validationWarnings: string[];
}) {
  const intl = useIntl();

  if (!requestError && !hasFieldErrors && validationWarnings.length === 0) {
    return null;
  }

  return (
    <>
      {requestError ? (
        <Alert variant="danger">{requestError}</Alert>
      ) : null}
      {hasFieldErrors && !requestError ? (
        <Alert variant="danger">
          {intl.formatMessage({
            id: "studio.validationSummary.fixErrors",
            defaultMessage: "Please fix the errors below.",
          })}
        </Alert>
      ) : null}
      {validationWarnings.length > 0 ? (
        <Alert variant="warning">
          <ul className="ai-eval-alert-list">
            {validationWarnings.map((warning, index) => {
              return <li key={String(index)}>{warning}</li>;
            })}
          </ul>
        </Alert>
      ) : null}
    </>
  );
}
