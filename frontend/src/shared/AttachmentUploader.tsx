import React, { useId, useRef } from "react";
import { Icon, IconButton, OverlayTrigger, Tooltip } from "@openedx/paragon";
import { AttachFile } from "@openedx/paragon/icons";
import { defineMessages, useIntl } from "react-intl";

import { AttachmentChip, AttachmentChipList } from "./AttachmentChips";
import { UploadAlert } from "./UploadAlert";
import { AttachmentUploads } from "./useAttachmentUploads";

const messages = defineMessages({
  uploadFile: {
    id: "attachments.uploader.uploadFile",
    defaultMessage: "Upload file: {remaining} remaining",
  },
  uploaded: {
    id: "attachments.uploader.status.uploaded",
    defaultMessage: "{filename} uploaded",
  },
});

interface AttachmentUploaderProps {
  uploads: AttachmentUploads;
  disabled: boolean;
  /** Stack the chips vertically, for narrow panes. */
  stacked?: boolean;
  /** The composer's text input, shown between the chips and the upload button. */
  children: React.ReactNode;
}

/**
 * The upload controls around a composer's text input: alerts and file chips above it, and the upload button below.
 * Renders only the text input when the pane doesn't take uploads.
 */
export function AttachmentUploader({ uploads, disabled, stacked = false, children }: AttachmentUploaderProps) {
  const intl = useIntl();
  const tooltipId = useId();
  const uploaderRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);

  if (!uploads.enabled) {
    return <>{children}</>;
  }

  const uploadButtonLabel = intl.formatMessage(messages.uploadFile, { remaining: uploads.remaining });
  const uploadedStatus = uploads.lastUploadedFilename
    ? intl.formatMessage(messages.uploaded, { filename: uploads.lastUploadedFilename })
    : "";

  return (
    <div className="attachment-uploader" ref={uploaderRef}>
      {uploads.alertCode ? (
        <UploadAlert
          key={uploads.alertKey}
          code={uploads.alertCode}
          limit={uploads.limit}
          remaining={uploads.remaining}
          fileLimits={uploads.fileLimits}
          onDismiss={uploads.dismissAlert}
        />
      ) : null}
      {uploads.composerAttachments.length > 0 ? (
        <AttachmentChipList stacked={stacked}>
          {uploads.composerAttachments.map(({ key, filename, upload }) => (
            <AttachmentChip
              key={key}
              filename={filename}
              contentType={upload === null ? null : upload.content_type}
              onRemove={upload === null || disabled || uploads.uploading ? null : () => {
                uploads.removeAttachment(key, upload);
                // The chip and its button go away, so keep keyboard focus in the uploader.
                uploadButtonRef.current?.focus();
              }}
            />
          ))}
        </AttachmentChipList>
      ) : null}
      {children}
      {/* Announces finished uploads. Uploading chips' spinners announce the start, and alerts announce errors. */}
      <div className="sr-only" role="status" aria-live="polite" data-testid="upload-status">
        {uploadedStatus}
      </div>
      <div className="attachment-uploader__toolbar">
        <OverlayTrigger
          placement="top"
          overlay={<Tooltip id={tooltipId}>{uploadButtonLabel}</Tooltip>}
          // Render the tooltip inside the block's Shadow DOM, not at the end of the page's <body>, where the host
          // page's own .tooltip styles (the LMS adds a border and an extra arrow) would apply to it.
          container={() => uploaderRef.current}
        >
          <IconButton
            ref={uploadButtonRef}
            src={AttachFile}
            iconAs={Icon}
            size="sm"
            alt={uploadButtonLabel}
            disabled={disabled}
            // While files upload, the button looks and acts disabled but stays focusable. Disabling it would drop
            // keyboard focus, which returns to it from the file picker.
            className={uploads.uploading ? "disabled" : undefined}
            aria-disabled={uploads.uploading || undefined}
            onClick={() => {
              if (uploads.uploading) {
                return;
              }
              if (uploads.remaining === 0) {
                uploads.showLimitReached();
              } else {
                fileInputRef.current?.click();
              }
            }}
          />
        </OverlayTrigger>
        <input
          ref={fileInputRef}
          type="file"
          className="d-none"
          multiple
          accept={uploads.fileLimits.accept}
          data-testid="attachment-file-input"
          onChange={(event) => {
            uploads.uploadFiles(Array.from(event.target.files as FileList));
            // Clear the input so selecting the same file again fires another change event.
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
