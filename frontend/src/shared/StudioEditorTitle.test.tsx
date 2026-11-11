import React, { useState } from "react";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../test/helpers";
import { StudioEditorTitle } from "./StudioEditorTitle";

function TitleWithState({ initialName }: { initialName: string }) {
  const [displayName, setDisplayName] = useState(initialName);
  return <StudioEditorTitle displayName={displayName} onDisplayNameChange={setDisplayName} />;
}

describe("StudioEditorTitle", () => {
  it("shows the component name without an \"Editing\" prefix", () => {
    render(<TitleWithState initialName="Short Answer with AI Evaluation" />);

    expect(screen.getByRole("heading", { name: "Short Answer with AI Evaluation" })).toBeInTheDocument();
  });

  it("edits the name in place and keeps it on Enter", async () => {
    const user = userEvent.setup();
    render(<TitleWithState initialName="Old name" />);

    await user.click(screen.getByRole("button", { name: "Edit component name" }));
    const nameInput = screen.getByRole("textbox", { name: "Component name" });
    await user.clear(nameInput);
    await user.type(nameInput, "New name{Enter}");

    expect(screen.queryByRole("textbox", { name: "Component name" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New name" })).toBeInTheDocument();
  });

  it("keeps the new name when the input loses focus", async () => {
    const user = userEvent.setup();
    render(<TitleWithState initialName="Old name" />);

    await user.click(screen.getByRole("button", { name: "Edit component name" }));
    await user.type(screen.getByRole("textbox", { name: "Component name" }), " updated");
    await user.tab();

    expect(screen.getByRole("heading", { name: "Old name updated" })).toBeInTheDocument();
  });

  it("restores the previous name on Escape", async () => {
    const user = userEvent.setup();
    render(<TitleWithState initialName="Old name" />);

    await user.click(screen.getByRole("button", { name: "Edit component name" }));
    await user.type(screen.getByRole("textbox", { name: "Component name" }), " changed{Escape}");

    expect(screen.getByRole("heading", { name: "Old name" })).toBeInTheDocument();
  });
});
