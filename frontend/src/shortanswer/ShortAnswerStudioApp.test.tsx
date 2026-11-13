import React from "react";
import { render, screen, waitFor, within } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import ShortAnswerStudioApp from "./ShortAnswerStudioApp";
import { ShortAnswerStudioPayload } from "./types";
import { BACKGROUND_OPTIONS } from "./appearance";
import { getFileInput, makeJsonFile, makeRuntime, mockSuccessfulSave } from "../test/testUtils";

function makePayload(): ShortAnswerStudioPayload {
  return {
    view: "studio",
    handler_urls: { studio_submit: "/handler/studio_submit" },
    initial_state: {
      display_name: "Existing display name",
      show_display_name: true,
      model: "gpt-4o",
      model_api_key: "test-key",
      question: "What did you learn?",
      hide_question: false,
      max_responses: 3,
      attachment_urls: [],
    },
    meta: {
      field_metadata: {
        display_name: { display_name: "Display Name" },
        show_display_name: { display_name: "Show Display Name" },
        model: { choices: [{ value: "gpt-4o", display_name: "GPT-4o" }] },
      },
    },
    mfe_config_api: "/mfe_config",
    style_urls: [],
  };
}

function renderEditor(ui: React.ReactElement) {
  return render(
    <div className="edit-xblock-modal">
      <div className="editor-body">{ui}</div>
      <ul className="modal-actions">
        <li><a className="action-save" href="#">Legacy Save</a></li>
        <li><a className="action-cancel" href="#">Legacy Cancel</a></li>
      </ul>
    </div>,
  );
}

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = mockSuccessfulSave();
});

afterEach(() => {
  global.fetch = originalFetch;
});

it("initializes a default background without changing the display-name controls", () => {
  render(<ShortAnswerStudioApp payload={makePayload()} />);
  expect(screen.getByRole("radio", { name: "Use course default" })).toBeChecked();
  expect(screen.getByText("Editing: Existing display name")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Show Display Name" })).toBeChecked();
  expect(screen.getByRole("group", { name: "Container background" })).toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Container background" })).getAllByRole("radio")).toHaveLength(5);
});

it.each(BACKGROUND_OPTIONS)("saves the $value thumbnail key and the display name", async (option) => {
  const user = userEvent.setup();
  const notify = jest.fn();
  render(<ShortAnswerStudioApp payload={makePayload()} runtime={{ notify, handlerUrl: jest.fn() }} />);
  await user.click(screen.getByRole("button", { name: "Edit display name" }));
  await user.clear(screen.getByLabelText("Display name"));
  await user.type(screen.getByLabelText("Display name"), "My reflection{enter}");
  await user.click(screen.getByRole("radio", { name: option.label.defaultMessage }));
  expect(screen.getByRole("radio", { name: option.label.defaultMessage })).toBeChecked();
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const submitted = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(submitted).toMatchObject({
    display_name: "My reflection",
    background_theme: option.value,
    show_display_name: true,
  });
  await waitFor(() => expect(notify).toHaveBeenCalledWith("save", { state: "end" }));
});

it("reopens a saved background selection and can restore the course default", async () => {
  const payload = makePayload();
  payload.initial_state.background_theme = "navy";
  const user = userEvent.setup();
  render(<ShortAnswerStudioApp payload={payload} />);
  expect(screen.getByRole("radio", { name: "Navy 50" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Use course default" }));
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    background_theme: "default",
  });
});

it("supports keyboard selection and does not save cancelled changes", async () => {
  const user = userEvent.setup();
  const notify = jest.fn();
  render(<ShortAnswerStudioApp payload={makePayload()} runtime={{ notify, handlerUrl: jest.fn() }} />);
  screen.getByRole("radio", { name: "Use course default" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "Lake 50" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: /^cancel$/i }));
  expect(notify).toHaveBeenCalledWith("cancel", {});
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows a server background-validation error and leaves the editor open", async () => {
  fetchMock.mockResolvedValue({
    ok: true, status: 200,
    text: async () => JSON.stringify({
      success: false,
      validation_errors: { background_theme: ["Select a valid course theme background."] },
      validation_warnings: [],
    }),
  });
  const notify = jest.fn();
  const user = userEvent.setup();
  render(<ShortAnswerStudioApp payload={makePayload()} runtime={{ notify, handlerUrl: jest.fn() }} />);
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  expect(await screen.findByText("Select a valid course theme background.")).toBeVisible();
  expect(notify).not.toHaveBeenCalledWith("save", { state: "end" });
});

describe("ShortAnswerStudioApp — StudioEditorLayout integration", () => {
  it("saves through the React layout", async () => {
    const user = userEvent.setup();
    const runtime = makeRuntime();

    renderEditor(<ShortAnswerStudioApp payload={makePayload()} runtime={runtime} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(runtime.notify).toHaveBeenCalledWith("save", { state: "end" });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/handler/studio_submit",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the JSON tab when JSON editing is enabled", () => {
    const runtime = makeRuntime();

    const payload = makePayload();
    payload.meta.json_editing_enabled = true;

    renderEditor(
      <ShortAnswerStudioApp
        payload={payload}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    expect(screen.getByText("JSON")).toBeInTheDocument();
  });

  it("hides the JSON tab when JSON editing is disabled", () => {
    const runtime = makeRuntime();

    renderEditor(
      <ShortAnswerStudioApp
        payload={makePayload()}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    expect(screen.queryByText("JSON")).not.toBeInTheDocument();
  });

  it("validates uploaded JSON using shortAnswerSchema", async () => {
    const user = userEvent.setup();
    const runtime = makeRuntime();

    const payload = makePayload();
    payload.meta.json_editing_enabled = true;

    const { container } = renderEditor(
      <ShortAnswerStudioApp
        payload={payload}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    await user.click(screen.getByText("JSON"));

    expect(screen.getByText("Import")).toBeInTheDocument();

    await userEvent.upload(
      getFileInput(container),
      makeJsonFile(JSON.stringify({ max_responses: 50, model: "" }), "test.json"),
    );

    const heading = await screen.findByText("JSON validation failed!");
    expect(heading).toBeInTheDocument();
    const alertBox = heading.closest(".alert") || heading.parentElement!;
    expect(within(alertBox as HTMLElement).getByText("max_responses")).toBeInTheDocument();
    expect(
      within(alertBox as HTMLElement).getByText("max responses must be an integer between 1 and 30"),
    ).toBeInTheDocument();
  });

  it("wires the tablist to the tab panes with ARIA attributes", async () => {
    const user = userEvent.setup();
    const runtime = makeRuntime();

    const payload = makePayload();
    payload.meta.json_editing_enabled = true;

    renderEditor(
      <ShortAnswerStudioApp
        payload={payload}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    const settingsTab = screen.getByRole("tab", { name: "Settings" });
    const jsonTab = screen.getByRole("tab", { name: "JSON" });
    const settingsPanel = document.getElementById(
      settingsTab.getAttribute("aria-controls")!,
    )!;
    const jsonPanel = document.getElementById(jsonTab.getAttribute("aria-controls")!)!;

    expect(settingsPanel).toHaveAttribute("role", "tabpanel");
    expect(settingsPanel).toHaveAttribute("aria-labelledby", settingsTab.id);
    expect(settingsPanel).toHaveAttribute("aria-hidden", "false");
    expect(jsonPanel).toHaveAttribute("aria-labelledby", jsonTab.id);
    expect(jsonPanel).toHaveAttribute("aria-hidden", "true");

    await user.click(jsonTab);

    expect(jsonTab).toHaveAttribute("aria-selected", "true");
    expect(jsonPanel).toHaveAttribute("aria-hidden", "false");
    expect(settingsPanel).toHaveAttribute("aria-hidden", "true");
  });
});
