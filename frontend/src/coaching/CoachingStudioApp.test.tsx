import React from "react";
import userEvent from "@testing-library/user-event";
import CoachingStudioApp from "./CoachingStudioApp";
import { CoachingStudioPayload } from "./types";
import { render, screen, waitFor, within } from "../test/helpers";
import { getFileInput, makeJsonFile, makeRuntime, mockSuccessfulSave } from "../test/testUtils";

function makePayload(overrides?: Partial<CoachingStudioPayload>): CoachingStudioPayload {
  return {
    view: "studio",
    handler_urls: {
      studio_submit: "/handler/studio_submit",
    },
    initial_state: {
      display_name: "Coaching",
      model: "gpt-4o",
      blacklist: [],
      scenario_data: { case_details: "", evaluation_criteria: [], learning_objectives: [] },
      workspace_attachment_urls: ["http://example.com/w.txt"],
      coach_attachment_urls: ["http://example.com/c.txt"],
      evaluator_attachment_urls: ["http://example.com/e.txt"],
    },
    meta: {
      field_metadata: {},
    },
    mfe_config_api: "/mfe_config",
    style_urls: [],
    ...overrides,
  };
}

function getSectionButton(name: RegExp) {
  return screen.getByRole("button", { name });
}

function makeJsonPayload(
  overrides?: Partial<CoachingStudioPayload>,
): CoachingStudioPayload {
  return makePayload({
    ...overrides,
    meta: {
      ...makePayload().meta,
      ...overrides?.meta,
      json_editing_enabled: true,
    },
  });
}

function renderJsonEditor(
  overrides: { payload?: Partial<CoachingStudioPayload> } = {},
) {
  return render(
    <CoachingStudioApp
      payload={makeJsonPayload(overrides.payload)}
      runtime={makeRuntime()}
      element={document.createElement("div")}
    />,
  );
}

function getValidationAlert(): HTMLElement {
  const heading = screen.getByText("JSON validation failed!");
  return (heading.closest(".alert") || heading.parentElement!) as HTMLElement;
}

describe("CoachingStudioApp attachment URL fields", () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("renders the seeded workspace attachment URL", async () => {
    const user = userEvent.setup();
    render(<CoachingStudioApp payload={makePayload()} />);

    await user.click(getSectionButton(/workspace/i));

    expect(screen.getByDisplayValue("http://example.com/w.txt")).toBeInTheDocument();
  });

  it("renders the seeded coach attachment URL", async () => {
    const user = userEvent.setup();
    render(<CoachingStudioApp payload={makePayload()} />);

    await user.click(getSectionButton(/coach chat/i));

    expect(screen.getByDisplayValue("http://example.com/c.txt")).toBeInTheDocument();
  });

  it("renders the seeded evaluator attachment URL", async () => {
    const user = userEvent.setup();
    render(<CoachingStudioApp payload={makePayload()} />);

    await user.click(getSectionButton(/evaluation/i));

    expect(screen.getByDisplayValue("http://example.com/e.txt")).toBeInTheDocument();
  });

  it("submits the three attachment URL lists and drops empty rows", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ success: true, validation_errors: {}, validation_warnings: [], meta: {} }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const user = userEvent.setup();
    render(
      <CoachingStudioApp
        payload={makePayload({
          initial_state: {
            display_name: "Coaching",
            model: "gpt-4o",
            blacklist: [],
            scenario_data: { case_details: "", evaluation_criteria: [], learning_objectives: [] },
            // Seed a valid row plus an empty row that should be dropped on submit.
            workspace_attachment_urls: ["http://example.com/w.txt", ""],
            coach_attachment_urls: ["http://example.com/c.txt"],
            evaluator_attachment_urls: ["http://example.com/e.txt"],
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/handler/studio_submit", expect.any(Object));
    });

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);

    expect(body.workspace_attachment_urls).toEqual(["http://example.com/w.txt"]);
    expect(body.coach_attachment_urls).toEqual(["http://example.com/c.txt"]);
    expect(body.evaluator_attachment_urls).toEqual(["http://example.com/e.txt"]);
  });
});

describe("CoachingStudioApp JSON import/export", () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("shows the JSON tab when JSON editing is enabled", () => {
    renderJsonEditor();

    expect(screen.getByRole("tab", { name: "JSON" })).toBeInTheDocument();
  });

  it("hides the JSON tab when JSON editing is disabled", () => {
    render(
      <CoachingStudioApp
        payload={makePayload()}
        runtime={makeRuntime()}
        element={document.createElement("div")}
      />,
    );

    expect(screen.queryByRole("tab", { name: "JSON" })).not.toBeInTheDocument();
  });

  it("validates uploaded JSON using coachingSchema", async () => {
    const user = userEvent.setup();
    const fetchMock = mockSuccessfulSave();
    const { container } = renderJsonEditor();

    await user.click(screen.getByRole("tab", { name: "JSON" }));
    await userEvent.upload(
      getFileInput(container),
      makeJsonFile(JSON.stringify({ model: "" })),
    );

    const alertBox = getValidationAlert();
    expect(within(alertBox).getByText("model")).toBeInTheDocument();
    expect(
      within(alertBox).getByText(
        "Model field is mandatory - please select one from the dropdown.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects nested non-string values", async () => {
    const user = userEvent.setup();
    const fetchMock = mockSuccessfulSave();
    const { container } = renderJsonEditor();

    await user.click(screen.getByRole("tab", { name: "JSON" }));
    await userEvent.upload(
      getFileInput(container),
      makeJsonFile(JSON.stringify({
        model: "gpt-4o-mini",
        display_name: null,
        allow_reset: null,
        blacklist: ["AI assistant", null],
        workspace_attachment_urls: [false],
        scenario_data: {
          case_details: null,
          learning_objectives: [null],
          evaluation_criteria: [{ name: null }],
        },
      })),
    );

    const alertBox = getValidationAlert();
    expect(within(alertBox).getByText("display_name")).toBeInTheDocument();
    expect(within(alertBox).getByText("allow_reset")).toBeInTheDocument();
    expect(within(alertBox).getByText("blacklist[1]")).toBeInTheDocument();
    expect(within(alertBox).getByText("workspace_attachment_urls[0]")).toBeInTheDocument();
    expect(within(alertBox).getByText("scenario_data.case_details")).toBeInTheDocument();
    expect(within(alertBox).getByText("scenario_data.learning_objectives[0]")).toBeInTheDocument();
    expect(
      within(alertBox).getByText("scenario_data.evaluation_criteria[0].name"),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
