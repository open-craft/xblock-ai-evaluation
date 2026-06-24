import React from "react";
import { render, screen, waitFor } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import CoachingStudioApp from "./CoachingStudioApp";
import { CoachingStudioPayload } from "./types";

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
