import React from "react";
import { Alert } from "@openedx/paragon";

export function StudioValidationSummary({
  requestError,
  validationWarnings,
}: {
  requestError: string;
  validationWarnings: string[];
}) {
  if (!requestError && validationWarnings.length === 0) {
    return null;
  }

  return (
    <>
      {requestError ? (
        <Alert variant="danger">{requestError}</Alert>
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
