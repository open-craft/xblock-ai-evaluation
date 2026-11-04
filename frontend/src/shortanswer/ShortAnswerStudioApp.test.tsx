import React from "react";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "../test/helpers";
import ShortAnswerStudioApp from "./ShortAnswerStudioApp";
import { ShortAnswerStudioMeta, ShortAnswerStudioPayload, ShortAnswerStudioState } from "./types";

const INITIAL_STATE: ShortAnswerStudioState = {
  allow_reset: false,
  attachment_urls: [],
  character_image: "",
  display_name: "Short Answer with AI Evaluation",
  show_display_name: false,
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
