import React from "react";
import { render, screen, waitFor, within } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import ShortAnswerStudioApp from "./ShortAnswerStudioApp";
import { ShortAnswerStudioPayload } from "./types";
import { BACKGROUND_OPTIONS } from "./appearance";

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

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, validation_errors: {}, validation_warnings: [] }),
  });
  global.fetch = fetchMock;
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
