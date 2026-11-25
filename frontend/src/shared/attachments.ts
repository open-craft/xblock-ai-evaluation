import { defineMessages } from "react-intl";

import { RequestError } from "./request";
import { UnknownRecord } from "./types";

export type UploadPane = "shortanswer" | "workspace" | "coach";

export type UploadContentType = "application/pdf" | "text/plain" | "text/markdown" | "text/csv";

/** A file attached to a learner message, as the server stores it in session state. */
export interface MessageAttachment {
  upload_id: string;
  filename: string;
  content_type: UploadContentType;
}

/** Whether learners can upload files to a pane and, if they can, how many. */
export type PaneUploadState =
  | { enabled: false }
  | { enabled: true; limit: number; remaining: number };

/** The per-file limits and accepted extensions, shared by every pane of a block. */
export interface UploadFileLimits {
  pdf_max_bytes: number;
  pdf_max_pages: number;
  text_max_bytes: number;
  accept: string;
}

/** The remaining uploads of each pane after a reset. Only panes where uploads are available are included. */
export type RemainingUploadsByPane = Partial<Record<UploadPane, number>>;

export interface UploadHandlerUrls {
  upload_file: string;
  delete_upload: string;
}

/**
 * The alerts the uploader can show. "limit_reached" is shown when the learner has no uploads left, "too_many_files"
 * when a selection has more files than remain, and "upload_failed" for any error without its own alert. The others
 * match the server's upload error codes.
 */
export type UploadAlertCode =
  | "limit_reached"
  | "too_many_files"
  | "file_too_large"
  | "unsupported_type"
  | "too_many_pages"
  | "uploads_disabled"
  | "upload_failed";

const SERVER_UPLOAD_ALERT_CODES: UploadAlertCode[] = [
  "file_too_large",
  "unsupported_type",
  "too_many_pages",
  "uploads_disabled",
];

export const UPLOAD_ALERT_MESSAGES = defineMessages({
  limit_reached: {
    id: "attachments.alert.limitReached",
    defaultMessage: "You've reached your file upload limit for this conversation.",
  },
  too_many_files: {
    id: "attachments.alert.tooManyFiles",
    defaultMessage: "Try again with fewer files. <b>{remaining} of {limit}</b> uploads remaining.",
  },
  file_too_large: {
    id: "attachments.alert.fileTooLarge",
    defaultMessage: "Try a smaller file. PDFs: max <b>{pdfMegabytes} MB</b>; TXT/MD/CSV: max <b>{textKilobytes} KB</b>.",
  },
  unsupported_type: {
    id: "attachments.alert.unsupportedType",
    defaultMessage: "Try a different file type. Supported: <b>{fileTypes}</b>.",
  },
  too_many_pages: {
    id: "attachments.alert.tooManyPages",
    defaultMessage: "Try a shorter PDF. Max <b>{pages} pages</b>.",
  },
  uploads_disabled: {
    id: "attachments.alert.uploadsDisabled",
    defaultMessage: "File uploads aren't available right now.",
  },
  upload_failed: {
    id: "attachments.alert.uploadFailed",
    defaultMessage: "Please try again later. A network or server error occurred.",
  },
});

function fileExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

function acceptedExtensions(fileLimits: UploadFileLimits) {
  return fileLimits.accept.split(",");
}

function maxBytesForFile(file: File, fileLimits: UploadFileLimits) {
  return fileExtension(file.name) === ".pdf" ? fileLimits.pdf_max_bytes : fileLimits.text_max_bytes;
}

/** The accepted file types for display, such as "PDF, TXT, MD, CSV". */
export function supportedFileTypes(fileLimits: UploadFileLimits) {
  return acceptedExtensions(fileLimits).map((extension) => extension.slice(1).toUpperCase()).join(", ");
}

/**
 * Check a selection of files before uploading any of them. Returns the alert to show if the whole selection is
 * rejected, or null if it can be uploaded. The PDF page count is only checked by the server.
 */
export function checkFileSelection(
  files: File[],
  remaining: number,
  fileLimits: UploadFileLimits,
): UploadAlertCode | null {
  if (files.length > remaining) {
    return "too_many_files";
  }

  const extensions = acceptedExtensions(fileLimits);
  if (files.some((file) => extensions.indexOf(fileExtension(file.name)) === -1)) {
    return "unsupported_type";
  }

  if (files.some((file) => file.size > maxBytesForFile(file, fileLimits))) {
    return "file_too_large";
  }

  return null;
}

/**
 * Whether the server rejected an upload because it's no longer one of the learner's pending uploads: it was already
 * sent, deleted (for example by a reset in another tab) or purged. Such a file can't be sent or removed.
 */
export function isUploadGoneError(error: unknown): boolean {
  return error instanceof RequestError && (error.payload as UnknownRecord).code === "invalid_upload";
}

/** Return the alert for a failed upload: the server's error code if it has its own alert, else "upload_failed". */
export function uploadAlertCodeForError(error: unknown): UploadAlertCode {
  if (!(error instanceof RequestError)) {
    return "upload_failed";
  }
  if (error.status === 413) {
    // A proxy in front of the LMS (such as Caddy) answers too large a body with its own 413, without an error code.
    return "file_too_large";
  }
  const serverCode = (error.payload as UnknownRecord).code;
  if (serverCode === "too_many_files") {
    // The server only rejects an upload for the count when no uploads are left (for example, after files were
    // uploaded in another tab).
    return "limit_reached";
  }
  return SERVER_UPLOAD_ALERT_CODES.find((code) => code === serverCode) ?? "upload_failed";
}
