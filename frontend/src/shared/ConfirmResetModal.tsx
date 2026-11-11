import React, { useId } from "react";
import {
  ActionRow,
  Button,
  ModalCloseButton,
  ModalPopup,
} from "@openedx/paragon";
import { useIntl } from "react-intl";
import { useFocusWithoutScroll } from "./useFocusWithoutScroll";

interface ConfirmResetModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  isOpen: boolean;
  positionRef: HTMLElement | null;
  placement?: "right" | "bottom-end";
  // Optional copy/variant overrides so individual blocks can match their design
  // without changing the shared defaults used by the other blocks.
  title?: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: React.ComponentProps<typeof Button>["variant"];
  dialogClassName?: string;
}

export const ConfirmResetModal = ({
  onConfirm,
  onCancel,
  isOpen,
  positionRef,
  placement = "right",
  title = "Start again?",
  body = "Your work will be cleared, and the activity will start again.",
  confirmLabel = "Start over",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  dialogClassName = "bg-white p-3 rounded shadow border",
}: ConfirmResetModalProps) => {
  const intl = useIntl();
  const titleText = intl.formatMessage({
    id: "resetConfirm.title",
    defaultMessage: title,
  });
  const bodyText = intl.formatMessage({
    id: "resetConfirm.body",
    defaultMessage: body,
  });
  const confirmText = intl.formatMessage({
    id: "resetConfirm.confirm",
    defaultMessage: confirmLabel,
  });
  const cancelText = intl.formatMessage({
    id: "resetConfirm.cancel",
    defaultMessage: cancelLabel,
  });

  const labelId = useId();
  const cancelButtonRef = useFocusWithoutScroll<HTMLButtonElement>(isOpen);

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
        placement={placement}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          className={dialogClassName}
        >
          <h3 id={labelId}>{titleText}</h3>
          <p>{bodyText}</p>

          <ActionRow>
            <ModalCloseButton ref={cancelButtonRef} onClick={onCancel} variant="tertiary">
              {cancelText}
            </ModalCloseButton>
            <Button onClick={onConfirm} variant={confirmVariant}>
              {confirmText}
            </Button>
          </ActionRow>
        </div>
      </ModalPopup>
    </div>
  );
};
