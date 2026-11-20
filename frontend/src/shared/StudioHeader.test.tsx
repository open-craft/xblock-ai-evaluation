import React from "react";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../test/helpers";
import { StudioHeader } from "./StudioHeader";

function renderHeader(props: Partial<React.ComponentProps<typeof StudioHeader>> = {}) {
  return render(
    <StudioHeader
      activeTab="settings"
      onTitleChange={jest.fn()}
      showJsonTab={false}
      title="Example component"
      {...props}
    />,
  );
}

describe("StudioHeader", () => {
  it("shows the title prefixed with Editing", () => {
    renderHeader();

    expect(screen.getByText("Editing: Example component")).toBeInTheDocument();
  });

  it("hides the tab switcher when JSON editing is disabled", () => {
    renderHeader({ showJsonTab: false });

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText("JSON")).not.toBeInTheDocument();
  });

  it("shows Settings and JSON tabs when JSON editing is enabled", () => {
    renderHeader({ showJsonTab: true });

    expect(screen.getByRole("tablist", { name: "Editor Sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "JSON" })).toBeInTheDocument();
  });

  it("labels the tablist and marks only the active tab as selected", () => {
    renderHeader({ showJsonTab: true, activeTab: "settings" });

    expect(screen.getByRole("tablist", { name: "Editor Sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "JSON" })).toHaveAttribute("aria-selected", "false");
  });

  it("moves focus from Settings to JSON with Tab", async () => {
    const user = userEvent.setup();

    renderHeader({ showJsonTab: true, activeTab: "settings" });

    await user.tab();
    expect(screen.getByRole("button", { name: "Edit display name" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("tab", { name: "JSON" })).toHaveFocus();
  });

  it("switches to an editable input and reports title changes", async () => {
    const user = userEvent.setup();
    const onTitleChange = jest.fn();

    function ControlledHeader() {
      const [title, setTitle] = React.useState("Example component");
      return (
        <StudioHeader
          activeTab="settings"
          onTitleChange={(nextTitle: string) => {
            onTitleChange(nextTitle);
            setTitle(nextTitle);
          }}
          showJsonTab={false}
          title={title}
        />
      );
    }

    render(<ControlledHeader />);

    await user.click(screen.getByRole("button", { name: "Edit display name" }));

    const input = screen.getByLabelText("Display name");
    expect(input).toHaveValue("Example component");

    await user.clear(input);
    await user.type(input, "Updated component");

    const calls = onTitleChange.mock.calls;
    expect(calls[calls.length - 1][0]).toBe("Updated component");
  });

  it("exits edit mode when Enter is pressed", async () => {
    const user = userEvent.setup();

    renderHeader();

    await user.click(screen.getByRole("button", { name: "Edit display name" }));
    await user.type(screen.getByLabelText("Display name"), "{enter}");

    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
    expect(screen.getByText("Editing: Example component")).toBeInTheDocument();
  });

  it("exits edit mode when Escape is pressed", async () => {
    const user = userEvent.setup();

    renderHeader();

    await user.click(screen.getByRole("button", { name: "Edit display name" }));
    await user.type(screen.getByLabelText("Display name"), "{escape}");

    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
  });

  it("flags the title field as invalid when display_name has errors", async () => {
    const user = userEvent.setup();

    renderHeader({ validationErrors: { display_name: ["Title is required"] } });

    await user.click(screen.getByRole("button", { name: "Edit display name" }));

    expect(screen.getByLabelText("Display name").className).toContain("is-invalid");
  });
});
