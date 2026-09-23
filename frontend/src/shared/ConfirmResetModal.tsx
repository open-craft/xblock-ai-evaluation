import React, { useId } from "react";
import {
  ActionRow,
  Button,
  ModalCloseButton,
  ModalPopup,
} from "@openedx/paragon";
import { useIntl } from "react-intl";

interface ConfirmResetModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  isOpen: boolean;
  positionRef: HTMLElement | null;
}

export const ConfirmResetModal = ({
  onConfirm,
  onCancel,
  isOpen,
  positionRef,
}: ConfirmResetModalProps) => {
  const intl = useIntl();
  const title = intl.formatMessage({
    id: "resetConfirm.title",
    defaultMessage: "Start again?",
  });

  const labelId = useId();

  if (!isOpen) {
    return null;
  }
  return (
    // This wrapper div ensures that you can't accidentally interact with the rest of the block while the popup is open.
    // Ideally this wouldn't be necessary, but the isBlocking behaviour of ModalPopup is buggy.
    <div className="modal-background">
      <ModalPopup
        hasArrow
        positionRef={positionRef}
        isOpen={isOpen}
        // XXX: I couldn't use the built-in onClose functionality, because it's too sensitive.
        // The onClose was triggered even when clicking the confirm button.
        onClose={() => {}}
        placement="right"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          className="bg-white p-3 rounded shadow border"
        >
          <h3 id={labelId}>{title}</h3>
          <p>
            {intl.formatMessage({
              id: "resetConfirm.body",
              defaultMessage:
                "Your work will be cleared, and the activity will start again.",
            })}
          </p>

          <ActionRow>
            <ModalCloseButton onClick={onCancel} variant="tertiary">
              {intl.formatMessage({
                id: "resetConfirm.cancel",
                defaultMessage: "Cancel",
              })}
            </ModalCloseButton>
            <Button onClick={onConfirm} variant="danger">
              {intl.formatMessage({
                id: "resetConfirm.confirm",
                defaultMessage: "Start over",
              })}
            </Button>
          </ActionRow>
        </div>
      </ModalPopup>
    </div>
  );
};
