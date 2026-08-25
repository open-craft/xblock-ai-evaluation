import React from "react";
import { Alert } from "@openedx/paragon";
import { Error } from '@openedx/paragon/icons';
import { useIntl } from "react-intl";

export interface ErrorData {
  title: string;  // a somewhat generic title for the error (eg. "Unable to submit code")
  message: string;  // the technical error string (eg. "TypeError: NetworkError when attempting to fetch resource.")
}

interface GenericErrorAlertProps {
  onClose: () => void;
  error: ErrorData;
}


export const GenericErrorAlert = ({
  onClose,
  error,
}: GenericErrorAlertProps) => {
  const intl = useIntl();

  return (
    <Alert
      show={true}
      variant='danger'
      icon={Error}
      onClose={onClose}
      dismissible
      className="mt-3"
      aria-live="polite"
    >
      <Alert.Heading>{error.title}</Alert.Heading>
      <p>
        {intl.formatMessage({
            id: "genericError.tryAgainLater",
            defaultMessage: 'Please try again. If the problem persists, contact support with this error: "{error}"',
          },
          { error: error.message, })}
      </p>
    </Alert>
  );
};
