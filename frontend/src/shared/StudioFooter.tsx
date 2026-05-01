import React, { useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import { ActionRow, Button } from "@openedx/paragon";

interface StudioFooterProps {
  i18nPrefix: string;
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function useHidePlatformModalActions(rootRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const root = rootRef.current;
    const modal = root?.closest(".edit-xblock-modal");
    const modalActions = modal?.querySelector(".modal-actions") as HTMLElement | null;

    if (!modalActions) {
      return undefined;
    }

    const previousDisplay = modalActions.style.display;
    modalActions.style.display = "none";

    return () => {
      modalActions.style.display = previousDisplay;
    };
  }, [rootRef]);
}

export function StudioFooter({
  i18nPrefix,
  isSaving,
  onCancel,
  onSave,
}: StudioFooterProps) {
  const intl = useIntl();
  const rootRef = useRef<HTMLDivElement>(null);
  useHidePlatformModalActions(rootRef);

  const saveLabel = isSaving
    ? intl.formatMessage({ id: `${i18nPrefix}.studio.savingButton`, defaultMessage: "Saving..." })
    : intl.formatMessage({ id: `${i18nPrefix}.studio.save`, defaultMessage: "Save" });
  const cancelLabel = intl.formatMessage({
    id: `${i18nPrefix}.studio.cancel`,
    defaultMessage: "Cancel",
  });

  return (
    <div className="ai-eval-studio-footer" ref={rootRef}>
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
  );
}
