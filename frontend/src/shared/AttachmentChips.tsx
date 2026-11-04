import React from "react";
import { Icon, IconButton, Spinner } from "@openedx/paragon";
import { Cancel, LibraryBooks, PictureAsPdf, TableChart } from "@openedx/paragon/icons";
import { defineMessages, useIntl } from "react-intl";

import { MessageAttachment, UploadContentType } from "./attachments";

const messages = defineMessages({
  fileList: {
    id: "attachments.chips.label",
    defaultMessage: "Attached files",
  },
  uploading: {
    id: "attachments.chip.uploading",
    defaultMessage: "Uploading",
  },
  uploadingType: {
    id: "attachments.chip.type.uploading",
    defaultMessage: "File",
  },
  remove: {
    id: "attachments.chip.remove",
    defaultMessage: "Remove {filename}",
  },
  pdf: {
    id: "attachments.chip.type.pdf",
    defaultMessage: "PDF",
  },
  plainText: {
    id: "attachments.chip.type.plainText",
    defaultMessage: "Plain Text",
  },
  markdown: {
    id: "attachments.chip.type.markdown",
    defaultMessage: "Markdown",
  },
  csv: {
    id: "attachments.chip.type.csv",
    defaultMessage: "CSV",
  },
});

const FILE_TYPE_DISPLAY = {
  "application/pdf": { icon: PictureAsPdf, label: messages.pdf, iconClassName: "attachment-chip__icon--pdf" },
  "text/plain": { icon: LibraryBooks, label: messages.plainText, iconClassName: "attachment-chip__icon--text" },
  "text/markdown": { icon: LibraryBooks, label: messages.markdown, iconClassName: "attachment-chip__icon--text" },
  "text/csv": { icon: TableChart, label: messages.csv, iconClassName: "attachment-chip__icon--csv" },
};

interface AttachmentChipProps {
  filename: string;
  /** The file's type, or null while it uploads. */
  contentType: UploadContentType | null;
  /** Removes the file, or null if it can't be removed (sent files, or while files upload). */
  onRemove: (() => void) | null;
}

export function AttachmentChip({ filename, contentType, onRemove }: AttachmentChipProps) {
  const intl = useIntl();
  const fileType = contentType === null ? null : FILE_TYPE_DISPLAY[contentType];

  return (
    <li className="attachment-chip">
      {fileType === null ? (
        <span className="attachment-chip__icon attachment-chip__icon--uploading">
          <Spinner animation="border" size="sm" screenReaderText={intl.formatMessage(messages.uploading)} />
        </span>
      ) : (
        <span className={"attachment-chip__icon " + fileType.iconClassName}>
          <Icon src={fileType.icon} size="sm" />
        </span>
      )}
      <span className="attachment-chip__details">
        <span className="attachment-chip__filename" title={filename}>{filename}</span>
        <span className="attachment-chip__type">
          {intl.formatMessage(fileType === null ? messages.uploadingType : fileType.label)}
        </span>
      </span>
      {onRemove ? (
        <IconButton
          className="attachment-chip__remove"
          src={Cancel}
          iconAs={Icon}
          size="inline"
          alt={intl.formatMessage(messages.remove, { filename })}
          onClick={onRemove}
        />
      ) : null}
    </li>
  );
}

interface AttachmentChipListProps {
  /** Stack the chips vertically, for narrow panes. */
  stacked?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function AttachmentChipList({ stacked = false, className = "", children }: AttachmentChipListProps) {
  const intl = useIntl();
  const listClassName = ["attachment-chips", stacked ? "attachment-chips--stacked" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <ul className={listClassName} aria-label={intl.formatMessage(messages.fileList)}>
      {children}
    </ul>
  );
}

interface AttachmentChipsProps {
  attachments: MessageAttachment[];
  stacked?: boolean;
  className?: string;
}

/** Read-only chips for the files of a sent message or a submission. */
export function AttachmentChips({ attachments, stacked = false, className = "" }: AttachmentChipsProps) {
  return (
    <AttachmentChipList stacked={stacked} className={className}>
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.upload_id}
          filename={attachment.filename}
          contentType={attachment.content_type}
          onRemove={null}
        />
      ))}
    </AttachmentChipList>
  );
}
