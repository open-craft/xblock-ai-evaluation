import React from "react";
import { Alert } from "@openedx/paragon";
import { Error as ErrorIcon } from "@openedx/paragon/icons";
import { useIntl } from "react-intl";

import { supportedFileTypes, UPLOAD_ALERT_MESSAGES, UploadAlertCode, UploadFileLimits } from "./attachments";

const BYTES_PER_KILOBYTE = 1024;

interface UploadAlertProps {
  code: UploadAlertCode;
  limit: number;
  remaining: number;
  fileLimits: UploadFileLimits;
  onDismiss: () => void;
}

export function UploadAlert({ code, limit, remaining, fileLimits, onDismiss }: UploadAlertProps) {
  const intl = useIntl();
  const isLimitReached = code === "limit_reached";
  const message = intl.formatMessage(UPLOAD_ALERT_MESSAGES[code], {
    b: (chunks: React.ReactNode[]) => <strong>{chunks}</strong>,
    remaining,
    limit,
    pdfMegabytes: fileLimits.pdf_max_bytes / (BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE),
    textKilobytes: fileLimits.text_max_bytes / BYTES_PER_KILOBYTE,
    fileTypes: supportedFileTypes(fileLimits),
    pages: fileLimits.pdf_max_pages,
  });

  return (
    <Alert
      className={isLimitReached ? "upload-alert upload-alert--limit-reached mb-0" : "upload-alert mb-0"}
      variant={isLimitReached ? "info" : "danger"}
      icon={isLimitReached ? undefined : ErrorIcon}
      dismissible
      onClose={onDismiss}
    >
      {message}
    </Alert>
  );
}
