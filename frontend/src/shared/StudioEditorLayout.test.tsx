import React from "react";
import userEvent from "@testing-library/user-event";

import CoachingStudioApp from "../coaching/CoachingStudioApp";
import { CoachingStudioPayload } from "../coaching/types";
import CodingStudioApp from "../coding/CodingStudioApp";
import { CodingStudioPayload } from "../coding/types";
import ShortAnswerStudioApp from "../shortanswer/ShortAnswerStudioApp";
import { ShortAnswerStudioPayload } from "../shortanswer/types";
import { render, screen, waitFor, within } from "../test/helpers";
import { XBlockRuntime } from "./types";
import { StudioEditorLayout } from "./StudioEditorLayout";

function renderInsideStudioModal(
  props: Partial<React.ComponentProps<typeof StudioEditorLayout>> = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const view = render(
    <div className="edit-xblock-modal">
      <div className="react-editor">
        <StudioEditorLayout
          i18nPrefix="test"
          isSaving={false}
          onCancel={jest.fn()}
          onSave={jest.fn()}
          {...props}
        />
      </div>
      <ul className="modal-actions">
        <li><a className="action-save" href="#">Legacy Save</a></li>
        <li><a className="action-cancel" href="#">Legacy Cancel</a></li>
      </ul>
    </div>,
    { container: host },
  );

  return {
    ...view,
    modalActions: host.querySelector(".modal-actions") as HTMLElement,
  };
}

describe("StudioEditorLayout", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("calls save and cancel from React-owned buttons", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    const onCancel = jest.fn();

    renderInsideStudioModal({ onSave, onCancel });

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both actions while saving", () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();

    renderInsideStudioModal({ isSaving: true, onSave, onCancel });

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

// --- Editor integration helpers ---

function renderEditor(ui: React.ReactElement, { includeLegacyActions = false } = {}) {
  return render(
    <div className="edit-xblock-modal">
      <div className="editor-body">{ui}</div>
      {includeLegacyActions && (
        <ul className="modal-actions">
          <li><a className="action-save" href="#">Legacy Save</a></li>
          <li><a className="action-cancel" href="#">Legacy Cancel</a></li>
        </ul>
      )}
    </div>,
  );
}

function makeRuntime() {
  return {
    handlerUrl: jest.fn(),
    notify: jest.fn(),
  } as unknown as XBlockRuntime & { notify: jest.Mock };
}

function mockSuccessfulSave() {
  const mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify({
      success: true,
      validation_errors: {},
      validation_warnings: [],
      meta: {},
    })),
  });
  global.fetch = mockFetch;
  return mockFetch;
}

const shortAnswerPayload: ShortAnswerStudioPayload = {
  view: "studio",
  handler_urls: { studio_submit: "/shortanswer/studio_submit" },
  initial_state: {
    allow_reset: true,
    attachment_urls: [],
    character_image: "",
    display_name: "Short answer with AI Evaluation",
    evaluation_prompt: "Evaluate the answer.",
    max_responses: 3,
    model: "gpt-4o-mini",
    model_api_key: "",
    model_api_url: "",
    question: "What is 2 + 2?",
    show_display_name: false,
  },
  meta: {
    field_metadata: {
      model: {
        display_name: "AI model",
        choices: [{ value: "gpt-4o-mini", display_name: "gpt-4o-mini" }],
      },
      show_display_name: {
        display_name: "Show Display Name",
      },
    },
  },
  mfe_config_api: "/mfe_config",
  style_urls: [],
};

const codingPayload: CodingStudioPayload = {
  view: "studio",
  handler_urls: { studio_submit: "/coding/studio_submit" },
  initial_state: {
    display_name: "Coding with AI Evaluation",
    evaluation_prompt: "Evaluate the code.",
    judge0_api_key: "",
    language: "python",
    model: "gpt-4o-mini",
    model_api_key: "",
    model_api_url: "",
    question: "Print hello world.",
  },
  meta: {
    field_metadata: {
      language: {
        display_name: "Language",
        choices: [{ value: "python", display_name: "Python" }],
      },
      model: {
        display_name: "AI model",
        choices: [{ value: "gpt-4o-mini", display_name: "gpt-4o-mini" }],
      },
    },
  },
  mfe_config_api: "/mfe_config",
  style_urls: [],
};

const coachingPayload: CoachingStudioPayload = {
  view: "studio",
  handler_urls: { studio_submit: "/coaching/studio_submit" },
  initial_state: {
    allow_reset: true,
    blacklist: [],
    character_1_avatar: "",
    character_1_name: "Learner",
    character_1_prompt: "Answer as a learner.",
    character_1_role: "Learner",
    character_2_avatar: "",
    character_2_name: "Coach",
    character_2_prompt: "Coach the learner.",
    character_2_role: "Coach",
    coach_initial_message: "How can I help?",
    coach_title: "Coach",
    display_name: "Coached AI Evaluation",
    evaluator_prompt: "Evaluate the learner.",
    initial_message: "Start here.",
    intro_text: "Intro",
    max_attempts: 3,
    model: "gpt-4o-mini",
    model_api_key: "",
    model_api_url: "",
    scenario_data: {
      case_details: "Scenario",
      evaluation_criteria: [{ name: "Criterion" }],
      learning_objectives: ["Objective"],
    },
    workspace_title: "Workspace",
  },
  meta: {
    field_metadata: {
      model: {
        display_name: "AI model",
        choices: [{ value: "gpt-4o-mini", display_name: "gpt-4o-mini" }],
      },
    },
  },
  mfe_config_api: "/mfe_config",
  style_urls: [],
};

describe("StudioEditorLayout — editor integration", () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("saves Short Answer through the React layout", async () => {
    const user = userEvent.setup();
    const runtime = makeRuntime();
    const fetch = mockSuccessfulSave();

    renderEditor(<ShortAnswerStudioApp payload={shortAnswerPayload} runtime={runtime} />, {
      includeLegacyActions: true,
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(runtime.notify).toHaveBeenCalledWith("save", { state: "end" });
    });
    expect(fetch).toHaveBeenCalledWith(
      "/shortanswer/studio_submit",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the JSON tab when JSON editing is enabled", () => {
    const runtime = makeRuntime();
    runtime.handlerUrl = jest.fn(
      (_element, handler) => `/handler/${handler}`,
    ) as unknown as XBlockRuntime["handlerUrl"];

    renderEditor(
      <ShortAnswerStudioApp
        payload={{
          ...shortAnswerPayload,
          meta: {
            ...shortAnswerPayload.meta,
            json_editing_enabled: true,
          },
        }}
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
        payload={shortAnswerPayload}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    expect(screen.queryByText("JSON")).not.toBeInTheDocument();
  });

  it("validates uploaded JSON in ShortAnswerStudioApp using shortAnswerSchema", async () => {
    const user = userEvent.setup();
    const runtime = makeRuntime();
    runtime.handlerUrl = jest.fn(
      (_element, handler) => `/handler/${handler}`,
    ) as unknown as XBlockRuntime["handlerUrl"];

    const { container } = renderEditor(
      <ShortAnswerStudioApp
        payload={{
          ...shortAnswerPayload,
          meta: {
            ...shortAnswerPayload.meta,
            json_editing_enabled: true,
          },
        }}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    await user.click(screen.getByText("JSON"));

    expect(screen.getByText("Import")).toBeInTheDocument();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).not.toBeNull();

    const file = new File([JSON.stringify({ max_responses: 50, model: "" })], "test.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(JSON.stringify({ max_responses: 50, model: "" })),
    });

    await userEvent.upload(input, file);

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
    runtime.handlerUrl = jest.fn(
      (_element, handler) => `/handler/${handler}`,
    ) as unknown as XBlockRuntime["handlerUrl"];

    renderEditor(
      <ShortAnswerStudioApp
        payload={{
          ...shortAnswerPayload,
          meta: { ...shortAnswerPayload.meta, json_editing_enabled: true },
        }}
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

  it("cancels Coding through the React layout", async () => {
    const user = userEvent.setup();
    const runtime = makeRuntime();

    renderEditor(<CodingStudioApp payload={codingPayload} runtime={runtime} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(runtime.notify).toHaveBeenCalledWith("cancel", {});
  });

  it("cancels Coaching through the React layout", async () => {
    const user = userEvent.setup();
    const runtime = makeRuntime();

    renderEditor(<CoachingStudioApp payload={coachingPayload} runtime={runtime} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(runtime.notify).toHaveBeenCalledWith("cancel", {});
  });
});
