import { useRef, useState } from "react";

import { deleteLearnerUpload, uploadLearnerFile } from "./api";
import {
  checkFileSelection,
  isUploadGoneError,
  MessageAttachment,
  PaneUploadState,
  RemainingUploadsByPane,
  UploadAlertCode,
  UploadFileLimits,
  UploadHandlerUrls,
  UploadPane,
  uploadAlertCodeForError,
} from "./attachments";

/** A file in the composer: uploading, or uploaded and waiting to be sent with the next message. */
interface ComposerAttachment {
  key: number;
  filename: string;
  /** The uploaded file, or null while it uploads. */
  upload: MessageAttachment | null;
}

interface AttachmentUploadsOptions {
  pane: UploadPane;
  paneState: PaneUploadState;
  fileLimits: UploadFileLimits;
  handlerUrls: UploadHandlerUrls;
}

/**
 * The learner's files in one pane's composer, and the actions on them.
 *
 * The composer sends `uploadedAttachments` with the next message, and must not send while `uploading`.
 * A pane where uploads aren't available has no files and no remaining uploads.
 */
export function useAttachmentUploads({ pane, paneState, fileLimits, handlerUrls }: AttachmentUploadsOptions) {
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [remaining, setRemaining] = useState(paneState.enabled ? paneState.remaining : 0);
  // Each alert gets a new key, so showing the same alert again re-mounts it and screen readers announce it again.
  const [uploadAlert, setUploadAlert] = useState<{ code: UploadAlertCode; key: number } | null>(null);
  // Announced when a file finishes uploading. An uploading chip's spinner already announces the start.
  const [lastUploadedFilename, setLastUploadedFilename] = useState<string | null>(null);
  const nextAttachmentKey = useRef(0);
  const nextAlertKey = useRef(0);

  const uploading = composerAttachments.some((attachment) => attachment.upload === null);
  const uploadedAttachments = composerAttachments
    .map((attachment) => attachment.upload)
    .filter((upload): upload is MessageAttachment => upload !== null);

  function showAlert(code: UploadAlertCode | null) {
    nextAlertKey.current += 1;
    setUploadAlert(code === null ? null : { code, key: nextAlertKey.current });
  }

  /** Record the remaining uploads after a delete. It freed an upload, so a "limit reached" alert no longer applies. */
  function recordFreedUpload(remainingAfterDelete: number) {
    setRemaining(remainingAfterDelete);
    setUploadAlert((current) => (current?.code === "limit_reached" ? null : current));
  }

  function toComposerAttachment(filename: string, upload: MessageAttachment | null): ComposerAttachment {
    nextAttachmentKey.current += 1;
    return { key: nextAttachmentKey.current, filename, upload };
  }

  async function uploadAttachment(key: number, file: File) {
    try {
      const { remaining: remainingAfterUpload, ...upload } = await uploadLearnerFile(
        handlerUrls.upload_file,
        pane,
        file,
      );
      setComposerAttachments((current) => current.map((attachment) => {
        return attachment.key === key ? { ...attachment, upload } : attachment;
      }));
      // Parallel uploads finish in any order. The smallest count is the one that included the most of them.
      setRemaining((current) => Math.min(current, remainingAfterUpload));
      setLastUploadedFilename(upload.filename);
    } catch (error) {
      setComposerAttachments((current) => current.filter((attachment) => attachment.key !== key));
      const alertCode = uploadAlertCodeForError(error);
      if (alertCode === "limit_reached") {
        setRemaining(0);
      }
      showAlert(alertCode);
    }
  }

  /** Upload a selection of files in parallel, unless the browser-side checks reject the whole selection. */
  function uploadFiles(files: File[]) {
    const rejection = checkFileSelection(files, remaining, fileLimits);
    showAlert(rejection);
    if (rejection) {
      return;
    }

    const newAttachments = files.map((file) => toComposerAttachment(file.name, null));
    setComposerAttachments((current) => current.concat(newAttachments));
    newAttachments.forEach((attachment, index) => {
      uploadAttachment(attachment.key, files[index]);
    });
  }

  /** Delete an uploaded file. Its chip goes at once, so it can't be removed twice or sent, and returns on failure. */
  async function removeAttachment(key: number, upload: MessageAttachment) {
    setComposerAttachments((current) => current.filter((attachment) => attachment.key !== key));
    try {
      const response = await deleteLearnerUpload(handlerUrls.delete_upload, pane, upload.upload_id);
      recordFreedUpload(response.remaining);
    } catch (error) {
      if (isUploadGoneError(error)) {
        // Already sent, deleted or purged on the server, so the chip stays removed.
        return;
      }
      setComposerAttachments((current) => current.concat({ key, filename: upload.filename, upload }));
      showAlert("upload_failed");
    }
  }

  /** Clear the composer when a message is sent with its files. */
  function clearAttachments() {
    setComposerAttachments([]);
    showAlert(null);
    setLastUploadedFilename(null);
  }

  /**
   * Handle a message that failed to send with these files. They normally go back in the composer so the learner can
   * retry, before any files uploaded while the message was sending. If the server rejected them as no longer
   * pending, they could never be sent or removed, so they're dropped instead; any of them that are still pending are
   * deleted, so no file without a chip keeps using an upload.
   */
  function handleFailedSend(sentAttachments: MessageAttachment[], error: unknown) {
    if (isUploadGoneError(error)) {
      sentAttachments.forEach(deleteIfStillPending);
      return;
    }
    const restoredAttachments = sentAttachments.map((upload) => toComposerAttachment(upload.filename, upload));
    setComposerAttachments((current) => restoredAttachments.concat(current));
  }

  async function deleteIfStillPending(upload: MessageAttachment) {
    try {
      const response = await deleteLearnerUpload(handlerUrls.delete_upload, pane, upload.upload_id);
      recordFreedUpload(response.remaining);
    } catch (error) {
      // Not pending any more, or the request failed: there's no chip to put back either way.
    }
  }

  /** Clear the composer after a reset, which deletes pending uploads and starts a fresh allowance. */
  function resetAttachments(remainingByPane: RemainingUploadsByPane) {
    clearAttachments();
    const remainingAfterReset = remainingByPane[pane];
    if (remainingAfterReset !== undefined) {
      setRemaining(remainingAfterReset);
    }
  }

  return {
    enabled: paneState.enabled,
    limit: paneState.enabled ? paneState.limit : 0,
    remaining,
    composerAttachments,
    uploadedAttachments,
    uploading,
    alertCode: uploadAlert?.code ?? null,
    alertKey: uploadAlert?.key,
    lastUploadedFilename,
    fileLimits,
    uploadFiles,
    removeAttachment,
    clearAttachments,
    handleFailedSend,
    resetAttachments,
    showLimitReached: () => showAlert("limit_reached"),
    dismissAlert: () => showAlert(null),
  };
}

export type AttachmentUploads = ReturnType<typeof useAttachmentUploads>;
