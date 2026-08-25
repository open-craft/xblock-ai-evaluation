import React from "react";
import { render, screen, waitFor } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import CoachingStudentApp from "./CoachingStudentApp";
import { CoachingStudentPayload } from "./types";
import * as api from "./api";

jest.mock("./api");

const mockSendChatMessage = api.sendChatMessage as jest.MockedFunction<typeof api.sendChatMessage>;
const mockResetAll = api.resetAll as jest.MockedFunction<typeof api.resetAll>;

function makePayload(overrides?: Partial<CoachingStudentPayload>): CoachingStudentPayload {
  return {
    view: "student",
    handler_urls: {
        get_character_response: "/handler/get_character_response",
        get_evaluator_response: "/handler/get_evaluator_response",
        reset_all: "/handler/reset_all",
        download_pdf: "/handler/download_pdf",
    },
    initial_state: {
      chat_histories: [[], []],
      finished: false,
      attempts: {
        attempts_remaining: 3,
        attempts_used: 0,
        can_retry: true,
        max_attempts: 3,
      },
    },
    meta: {
      allow_reset: true,
      characters: [
        { name: "Alex", avatar: "", pane: "workspace", role: "tutor" },
        { name: "Coach", avatar: "", pane: "coach", role: "coach" },
      ],
      initial_message: {
        character: { name: "Alex", avatar: "", pane: "workspace", role: "tutor" },
        content: "Hello, I'm Alex!",
        is_user: false,
        pane: "workspace",
      },
      coach_initial_message: {
        character: { name: "Coach", avatar: "", pane: "coach", role: "coach" },
        content: "Hi, I'm your coach.",
        is_user: false,
        pane: "coach",
      },
      intro_text: "Welcome to the activity.",
      titles: {
        workspace: "Main",
        coach: "Coach",
      },
      pdf_download_allowed: false,
      pdf_download_title: "",
      pdf_download_description: ""
    },
    mfe_config_api: "/mfe_config",
    style_urls: [],
    ...overrides,
  };
}

describe("CoachingStudentApp", () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders intro text", () => {
      render(<CoachingStudentApp payload={makePayload()} />);
      expect(screen.getByText("Welcome to the activity.")).toBeInTheDocument();
    });

    it("renders workspace and coach panes", () => {
      render(<CoachingStudentApp payload={makePayload()} />);
      expect(screen.getByRole("heading", { name: "Main" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Coach" })).toBeInTheDocument();
    });

    it("displays initial messages in both panes", () => {
      render(<CoachingStudentApp payload={makePayload()} />);
      expect(screen.getByText("Hello, I'm Alex!")).toBeInTheDocument();
      expect(screen.getByText("Hi, I'm your coach.")).toBeInTheDocument();
    });
  });

  describe("chat mode", () => {
    it("sends message to workspace character", async () => {
      mockSendChatMessage.mockResolvedValue({
        message: {
          character: { name: "Alex", avatar: "", pane: "workspace", role: "tutor" },
          content: "Great response!",
          is_user: false,
          pane: "workspace",
        },
        attempts: {
          attempts_remaining: 2,
          attempts_used: 1,
          can_retry: true,
          max_attempts: 3,
        },
        finished: false,
      });

      const user = userEvent.setup();
      render(<CoachingStudentApp payload={makePayload()} />);

      const textareas = screen.getAllByRole("textbox");
      const workspaceTextarea = textareas[0];
      await user.type(workspaceTextarea, "my response");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(mockSendChatMessage).toHaveBeenCalledWith(
          "/handler/get_character_response",
          0,
          "my response",
        );
      });
    });
  });

  describe("report mode", () => {
    it("hides coach pane in report mode", () => {
      const payload = makePayload({
        initial_state: {
          chat_histories: [[], []],
          finished: true,
          final_report: {
            report_html: "<p>Good job</p>",
            evaluation_markdown: "Good job",
            final_submission: "student answer",
            finished: true,
            show_report_card: true,
            attempts: {
              attempts_remaining: 0,
              attempts_used: 3,
              can_retry: false,
              max_attempts: 3,
            },
          },
          attempts: {
            attempts_remaining: 0,
            attempts_used: 3,
            can_retry: false,
            max_attempts: 3,
          },
        },
      });

      render(<CoachingStudentApp payload={payload} />);

      expect(screen.queryByText("Coach")).not.toBeInTheDocument();
    });

    it("displays evaluation report", () => {
      const payload = makePayload({
        initial_state: {
          chat_histories: [[], []],
          finished: true,
          final_report: {
            report_html: "<p>Well done on this assignment</p>",
            evaluation_markdown: "Well done on this assignment",
            final_submission: "student answer",
            finished: true,
            show_report_card: true,
            attempts: {
              attempts_remaining: 0,
              attempts_used: 3,
              can_retry: false,
              max_attempts: 3,
            },
          },
          attempts: {
            attempts_remaining: 0,
            attempts_used: 3,
            can_retry: false,
            max_attempts: 3,
          },
        },
      });

      render(<CoachingStudentApp payload={payload} />);
      expect(screen.getByText("Well done on this assignment")).toBeInTheDocument();
    });
  });

  describe("reset", () => {
    it("shows confirm dialog before reset", async () => {
      const user = userEvent.setup();
      render(<CoachingStudentApp payload={makePayload()} />);

      const resetButton = screen.getByRole("button", { name: /start again/i });
      await user.click(resetButton);

      // the confirm dialog is shown, and the reset should not have been called yet
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(mockResetAll).not.toHaveBeenCalled();

      const confirmResetBtn = screen.getByRole("button", { name: /start over/i });
      await user.click(confirmResetBtn);

      // now it should be called after clicking the confirm button
      expect(mockResetAll).toHaveBeenCalled();

    });

    it("cancels reset on dialog dismiss", async () => {
      const user = userEvent.setup();
      render(<CoachingStudentApp payload={makePayload()} />);

      const resetButton = screen.getByRole("button", { name: /start again/i });
      await user.click(resetButton);

      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      await user.click(cancelButton);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mockResetAll).not.toHaveBeenCalled();
    });
  });
});
