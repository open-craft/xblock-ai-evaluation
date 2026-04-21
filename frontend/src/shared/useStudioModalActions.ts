import { useEffect } from "react";
import { IntlShape } from "react-intl";

interface UseStudioModalActionsOptions {
  rootSelector: string;
  intl: IntlShape;
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
  i18nPrefix: string;
}

export function useStudioModalActions({
  rootSelector,
  intl,
  isSaving,
  onSave,
  onCancel,
  i18nPrefix,
}: UseStudioModalActionsOptions) {
  useEffect(() => {
    const root = document.querySelector(rootSelector);
    const modal = root?.closest(".edit-xblock-modal");
    const modalActions = modal?.querySelector(".modal-actions") as HTMLElement | null;
    const saveAction = modalActions?.querySelector(".action-save") as HTMLAnchorElement | null;
    const cancelAction = modalActions?.querySelector(".action-cancel") as HTMLAnchorElement | null;

    if (!modalActions || !saveAction || !cancelAction) {
      return;
    }

    modalActions.style.display = "block";

    const saveItem = saveAction.closest("li") as HTMLLIElement | null;
    const cancelItem = cancelAction.closest("li") as HTMLLIElement | null;
    if (saveItem) saveItem.style.display = "inline-block";
    if (cancelItem) cancelItem.style.display = "inline-block";

    const saveLabel = isSaving
      ? intl.formatMessage({ id: `${i18nPrefix}.studio.savingButton`, defaultMessage: "Saving..." })
      : intl.formatMessage({ id: `${i18nPrefix}.studio.save`, defaultMessage: "Save" });
    const cancelLabel = intl.formatMessage({
      id: `${i18nPrefix}.studio.cancel`,
      defaultMessage: "Cancel",
    });

    saveAction.className = "button action-primary action-save";
    cancelAction.className = "button action-cancel";
    saveAction.textContent = saveLabel;
    cancelAction.textContent = cancelLabel;
    saveAction.setAttribute("aria-disabled", String(isSaving));
    saveAction.classList.toggle("is-disabled", isSaving);

    const onSaveClick = (event: Event) => {
      event.preventDefault();
      onSave();
    };
    const onCancelClick = (event: Event) => {
      event.preventDefault();
      onCancel();
    };

    saveAction.addEventListener("click", onSaveClick);
    cancelAction.addEventListener("click", onCancelClick);

    return () => {
      saveAction.removeEventListener("click", onSaveClick);
      cancelAction.removeEventListener("click", onCancelClick);
    };
  }, [rootSelector, intl, isSaving, onSave, onCancel, i18nPrefix]);
}
