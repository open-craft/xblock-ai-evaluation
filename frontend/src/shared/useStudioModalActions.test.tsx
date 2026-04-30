import React from "react";
import { IntlProvider, useIntl } from "react-intl";
import { render } from "@testing-library/react";

import { useStudioModalActions } from "./useStudioModalActions";

function TestStudioActions({
  isSaving = false,
  onSave,
  onCancel,
}: {
  isSaving?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();

  useStudioModalActions({
    rootSelector: ".test-react-studio",
    intl,
    isSaving,
    onSave,
    onCancel,
    i18nPrefix: "test",
  });

  return null;
}

function renderHookIntoExistingModal(
  onSave: () => void,
  onCancel: () => void,
  isSaving = false,
) {
  document.body.innerHTML = `
    <div class="edit-xblock-modal">
      <div class="test-react-studio"></div>
      <ul class="modal-actions">
        <li><a class="action-save" href="#">Legacy Save</a></li>
        <li><a class="action-cancel" href="#">Legacy Cancel</a></li>
      </ul>
    </div>
  `;

  render(
    <IntlProvider locale="en" messages={{}}>
      <TestStudioActions isSaving={isSaving} onSave={onSave} onCancel={onCancel} />
    </IntlProvider>,
  );
}

function dispatchCancelableClick(element: Element) {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  const defaultWasAllowed = element.dispatchEvent(event);
  return { event, defaultWasAllowed };
}

describe("useStudioModalActions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("handles save without letting legacy Studio handlers run", () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();

    renderHookIntoExistingModal(onSave, onCancel);

    const modal = document.querySelector(".edit-xblock-modal") as HTMLElement;
    const saveAction = document.querySelector(".action-save") as HTMLAnchorElement;
    const sameElementLegacySave = jest.fn();
    const bubbledLegacySave = jest.fn();

    saveAction.addEventListener("click", sameElementLegacySave);
    modal.addEventListener("click", bubbledLegacySave);

    const { event, defaultWasAllowed } = dispatchCancelableClick(saveAction);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(sameElementLegacySave).not.toHaveBeenCalled();
    expect(bubbledLegacySave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(defaultWasAllowed).toBe(false);
  });

  it("handles cancel without letting legacy Studio handlers run", () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();

    renderHookIntoExistingModal(onSave, onCancel);

    const modal = document.querySelector(".edit-xblock-modal") as HTMLElement;
    const cancelAction = document.querySelector(".action-cancel") as HTMLAnchorElement;
    const sameElementLegacyCancel = jest.fn();
    const bubbledLegacyCancel = jest.fn();

    cancelAction.addEventListener("click", sameElementLegacyCancel);
    modal.addEventListener("click", bubbledLegacyCancel);

    const { event, defaultWasAllowed } = dispatchCancelableClick(cancelAction);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(sameElementLegacyCancel).not.toHaveBeenCalled();
    expect(bubbledLegacyCancel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(defaultWasAllowed).toBe(false);
  });

  it("suppresses cancel while saving without letting legacy Studio handlers run", () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();

    renderHookIntoExistingModal(onSave, onCancel, true);

    const modal = document.querySelector(".edit-xblock-modal") as HTMLElement;
    const cancelAction = document.querySelector(".action-cancel") as HTMLAnchorElement;
    const sameElementLegacyCancel = jest.fn();
    const bubbledLegacyCancel = jest.fn();

    cancelAction.addEventListener("click", sameElementLegacyCancel);
    modal.addEventListener("click", bubbledLegacyCancel);

    const { event, defaultWasAllowed } = dispatchCancelableClick(cancelAction);

    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(sameElementLegacyCancel).not.toHaveBeenCalled();
    expect(bubbledLegacyCancel).not.toHaveBeenCalled();
    expect(cancelAction).toHaveAttribute("aria-disabled", "true");
    expect(cancelAction).toHaveClass("is-disabled");
    expect(event.defaultPrevented).toBe(true);
    expect(defaultWasAllowed).toBe(false);
  });
});
