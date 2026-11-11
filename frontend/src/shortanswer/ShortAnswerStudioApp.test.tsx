import React from "react";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor, within } from "../test/helpers";
import ShortAnswerStudioApp from "./ShortAnswerStudioApp";
import { ShortAnswerStudioMeta, ShortAnswerStudioPayload, ShortAnswerStudioState } from "./types";
import { BACKGROUND_OPTIONS } from "./appearance";

const INITIAL_STATE: ShortAnswerStudioState = {
  allow_reset: false,
  attachment_urls: [],
  character_image: "",
  display_name: "Short Answer with AI Evaluation",
  show_display_name: false,
  background_theme: "default",
  evaluation_prompt: "Evaluate the answer.",
  max_responses: 3,
  model: "gpt-4o",
  model_api_key: "",
  model_api_url: "",
  question: "What did you learn?",
  hide_question: false,
  pdf_download_allowed: false,
  pdf_download_title: "",
  pdf_download_description: "",
  allow_learner_uploads: false,
  max_file_uploads: 3,
};

const FIELD_METADATA = {
  model: { display_name: "AI Model", choices: [{ value: "gpt-4o", display_name: "gpt-4o" }] },
  show_display_name: { display_name: "Show Component Name", help: "Display the component name as a heading." },
  model_api_key: { display_name: "Chosen model API Key" },
  model_api_url: { display_name: "Set your API URL" },
  hide_question: { display_name: "Hide Question" },
  question: { display_name: "Question" },
  evaluation_prompt: { display_name: "Evaluation Prompt" },
  attachment_urls: { display_name: "Attachment URLs" },
  character_image: { display_name: "Character Image URL" },
  allow_learner_uploads: {
    display_name: "File Upload",
    help: "Allow learners to upload a file as part of their response",
  },
  max_file_uploads: {
    display_name: "Max File Uploads",
    help: "Maximum number of files a learner can upload during the conversation",
  },
  max_responses: { display_name: "Max Responses" },
  allow_reset: { display_name: "Allow Reset" },
};

function makePayload(
  stateOverrides: Partial<ShortAnswerStudioState> = {},
  metaOverrides: Partial<ShortAnswerStudioMeta> = {},
): ShortAnswerStudioPayload {
  return {
    view: "studio",
    handler_urls: { studio_submit: "/handler/studio_submit" },
    initial_state: { ...INITIAL_STATE, ...stateOverrides },
    meta: {
      field_metadata: FIELD_METADATA,
      learner_uploads_enabled: true,
      max_file_uploads_ceiling: 10,
      ...metaOverrides,
    },
    mfe_config_api: "/mfe_config",
    style_urls: [],
  };
}

function mockSuccessfulSave() {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({ success: true, validation_errors: {}, validation_warnings: [], meta: {} }),
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

function submittedBody(fetchMock: jest.Mock) {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
}

describe("ShortAnswerStudioApp", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the name as an editable heading instead of a Display Name input", () => {
    render(<ShortAnswerStudioApp payload={makePayload()} />);

    expect(screen.getByRole("heading", { name: "Short Answer with AI Evaluation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit component name" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Short Answer with AI Evaluation")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Show Component Name" })).toBeInTheDocument();
  });

  it("saves the name edited in the heading", async () => {
    const fetchMock = mockSuccessfulSave();
    const user = userEvent.setup();
    render(<ShortAnswerStudioApp payload={makePayload()} />);

    await user.click(screen.getByRole("button", { name: "Edit component name" }));
    const nameInput = screen.getByRole("textbox", { name: "Component name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Reflection{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(submittedBody(fetchMock).display_name).toBe("Reflection");
  });

  it("orders the fields from Evaluation Prompt down as in the design", () => {
    render(<ShortAnswerStudioApp payload={makePayload({ allow_learner_uploads: true })} />);

    const labels = [
      "Evaluation Prompt",
      "Attachment URLs",
      "Character Image URL",
      "File Upload",
      "Max File Uploads",
      "Max Responses",
      "Allow Reset",
      "PDF Download",
    ].map((label) => screen.getByText(label));

    labels.slice(1).forEach((label, index) => {
      expect(labels[index].compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it("shows Max File Uploads only while File Upload is Yes", async () => {
    const user = userEvent.setup();
    render(<ShortAnswerStudioApp payload={makePayload()} />);

    expect(screen.getByRole("radio", { name: "No" })).toBeChecked();
    expect(screen.queryByLabelText("Max File Uploads")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Yes" }));

    expect(screen.getByLabelText("Max File Uploads")).toHaveValue(3);
  });

  it("hides the upload fields while uploads are off site-wide, but still submits them", async () => {
    const fetchMock = mockSuccessfulSave();
    const user = userEvent.setup();
    render(
      <ShortAnswerStudioApp
        payload={makePayload({ allow_learner_uploads: true, max_file_uploads: 0 }, { learner_uploads_enabled: false })}
      />,
    );

    expect(screen.queryByText("File Upload")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Max File Uploads")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(submittedBody(fetchMock)).toEqual(expect.objectContaining({
      allow_learner_uploads: true,
      max_file_uploads: 0,
    }));
  });

  it("submits the upload fields", async () => {
    const fetchMock = mockSuccessfulSave();
    const user = userEvent.setup();
    render(<ShortAnswerStudioApp payload={makePayload()} />);

    await user.click(screen.getByRole("radio", { name: "Yes" }));
    const maxFileUploadsInput = screen.getByLabelText("Max File Uploads");
    await user.clear(maxFileUploadsInput);
    await user.type(maxFileUploadsInput, "5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(submittedBody(fetchMock)).toEqual(expect.objectContaining({
      allow_learner_uploads: true,
      max_file_uploads: "5",
    }));
  });

  it("rejects Max File Uploads above the ceiling without saving", async () => {
    const fetchMock = mockSuccessfulSave();
    const user = userEvent.setup();
    render(
      <ShortAnswerStudioApp
        payload={makePayload({ allow_learner_uploads: true }, { max_file_uploads_ceiling: 4 })}
      />,
    );

    const maxFileUploadsInput = screen.getByLabelText("Max File Uploads");
    await user.clear(maxFileUploadsInput);
    await user.type(maxFileUploadsInput, "5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Max File Uploads must be an integer between 1 and 4.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's error for a model that can't read files", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({
        success: false,
        validation_errors: {
          allow_learner_uploads: ["The selected model can't read files. Choose another model or turn off File Upload."],
        },
        validation_warnings: [],
        meta: {},
      }),
    }) as unknown as typeof global.fetch;
    const user = userEvent.setup();
    render(<ShortAnswerStudioApp payload={makePayload({ allow_learner_uploads: true })} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("The selected model can't read files. Choose another model or turn off File Upload."),
    ).toBeInTheDocument();
  });
});

function makeBackgroundPayload(): ShortAnswerStudioPayload {
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
      learner_uploads_enabled: false,
      max_file_uploads_ceiling: 5,
    },
    mfe_config_api: "/mfe_config",
    style_urls: [],
  };
}

describe("ShortAnswerStudioApp background", () => {
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
    render(<ShortAnswerStudioApp payload={makeBackgroundPayload()} />);
    expect(screen.getByRole("radio", { name: "Use course default" })).toBeChecked();
    expect(screen.getByRole("heading", { name: "Existing display name" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Show Display Name" })).toBeChecked();
    expect(screen.getByRole("group", { name: "Container background" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Container background" })).getAllByRole("radio")).toHaveLength(5);
  });

  it.each(BACKGROUND_OPTIONS)("saves the $value thumbnail key and the display name", async (option) => {
    const user = userEvent.setup();
    const notify = jest.fn();
    render(<ShortAnswerStudioApp payload={makeBackgroundPayload()} runtime={{ notify, handlerUrl: jest.fn() }} />);
    await user.click(screen.getByRole("button", { name: "Edit component name" }));
    const nameInput = screen.getByRole("textbox", { name: "Component name" });
    await user.clear(nameInput);
    await user.type(nameInput, "My reflection{Enter}");
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
    const payload = makeBackgroundPayload();
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
    render(<ShortAnswerStudioApp payload={makeBackgroundPayload()} runtime={{ notify, handlerUrl: jest.fn() }} />);
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
    render(<ShortAnswerStudioApp payload={makeBackgroundPayload()} runtime={{ notify, handlerUrl: jest.fn() }} />);
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText("Select a valid course theme background.")).toBeVisible();
    expect(notify).not.toHaveBeenCalledWith("save", { state: "end" });
  });
});
