import React from "react";
import { useIntl } from "react-intl";
import { ActionRow, Button } from "@openedx/paragon";

interface StudioEditorLayoutProps {
  i18nPrefix: string;
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
  children?: React.ReactNode;
}

export function StudioEditorLayout({
  i18nPrefix,
  isSaving,
  onCancel,
  onSave,
  children,
}: StudioEditorLayoutProps) {
  const intl = useIntl();

  const saveLabel = isSaving
    ? intl.formatMessage({ id: `${i18nPrefix}.studio.savingButton`, defaultMessage: "Saving..." })
    : intl.formatMessage({ id: `${i18nPrefix}.studio.save`, defaultMessage: "Save" });
  const cancelLabel = intl.formatMessage({
    id: `${i18nPrefix}.studio.cancel`,
    defaultMessage: "Cancel",
  });

  return (
    <>
      {children}
      <div className="ai-eval-studio-actions">
        <ActionRow>
          <Button
            type="button"
            variant="tertiary"
            onClick={onCancel}
            disabled={isSaving}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onSave}
            disabled={isSaving}
          >
            {saveLabel}
          </Button>
        </ActionRow>
      </div>
    </>
  );
}
