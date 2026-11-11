import React from "react";
import { render, screen, waitFor } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import CoachingStudentApp from "./CoachingStudentApp";
import { CoachingStudentPayload, CoachingUploads } from "./types";
import * as api from "./api";
import * as uploadApi from "../shared/api";
import { RequestError } from "../shared/request";

jest.mock("./api");
jest.mock("../shared/api");

const mockSendChatMessage = api.sendChatMessage as jest.MockedFunction<typeof api.sendChatMessage>;
const mockResetAll = api.resetAll as jest.MockedFunction<typeof api.resetAll>;
const mockRequestEvaluation = api.requestEvaluation as jest.MockedFunction<typeof api.requestEvaluation>;
const mockUploadLearnerFile = uploadApi.uploadLearnerFile as jest.MockedFunction<typeof uploadApi.uploadLearnerFile>;
const mockDeleteLearnerUpload = uploadApi.deleteLearnerUpload as jest.MockedFunction<
  typeof uploadApi.deleteLearnerUpload
>;

const UPLOADS_DISABLED: CoachingUploads = {
  workspace: { enabled: false },
  coach: { enabled: false },
  pdf_max_bytes: 4194304,
  pdf_max_pages: 10,
  text_max_bytes: 51200,
  accept: ".pdf,.txt,.md,.csv",
};

function makePayload(overrides?: Partial<CoachingStudentPayload>): CoachingStudentPayload {
  return {
    view: "student",
    handler_urls: {
        get_character_response: "/handler/get_character_response",
        get_evaluator_response: "/handler/get_evaluator_response",
        reset_all: "/handler/reset_all",
        download_pdf: "/handler/download_pdf",
        upload_file: "/handler/upload_file",
        delete_upload: "/handler/delete_upload",
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
      uploads: UPLOADS_DISABLED,
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
          [],
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
            final_submission_attachments: [],
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
          uploads: UPLOADS_DISABLED,
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
            final_submission_attachments: [],
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
          uploads: UPLOADS_DISABLED,
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

  describe("submit", () => {
    it("shows confirm dialog before submit", async () => {
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

      const submitButton = screen.getByRole("button", { name: /submit for evaluation/i });
      await user.click(submitButton);

      // the confirm dialog is shown, and the submit api method should not have been called yet
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(mockRequestEvaluation).not.toHaveBeenCalled();

      const confirmSubmitButton = screen.getByRole("button", { name: /submit for evaluation/i });
      await user.click(confirmSubmitButton);

      // now it should be called after clicking the confirm button
      expect(mockRequestEvaluation).toHaveBeenCalled();

    });
  });

  describe("file uploads", () => {
    const UPLOADS_ENABLED: CoachingUploads = {
      ...UPLOADS_DISABLED,
      workspace: { enabled: true, limit: 3, remaining: 3 },
      coach: { enabled: true, limit: 3, remaining: 3 },
    };

    async function openSubmitDialog(uploads: CoachingUploads) {
      const user = userEvent.setup();
      const payload = makePayload();
      payload.initial_state = {
        ...payload.initial_state,
        attempts: { attempts_remaining: 2, attempts_used: 1, can_retry: true, max_attempts: 3 },
        uploads,
      };
      render(<CoachingStudentApp payload={payload} />);
      await user.click(screen.getByRole("button", { name: /submit for evaluation/i }));
      return screen.getByRole("dialog");
    }

    it("submit modal copy depends on uploads enabled", async () => {
      const dialogWithUploads = await openSubmitDialog(UPLOADS_ENABLED);
      expect(dialogWithUploads).toHaveTextContent(
        "your latest answer and your most recently sent file(s) will be evaluated.",
      );
    });

    it("disables submit while a workspace file uploads", async () => {
      let finishUpload: (response: uploadApi.UploadFileResponse) => void = () => {};
      mockUploadLearnerFile.mockReturnValue(new Promise((resolve) => {
        finishUpload = resolve;
      }));
      const user = userEvent.setup();
      const payload = makePayload();
      payload.initial_state = {
        ...payload.initial_state,
        attempts: { attempts_remaining: 2, attempts_used: 1, can_retry: true, max_attempts: 3 },
        uploads: UPLOADS_ENABLED,
      };
      render(<CoachingStudentApp payload={payload} />);
      const submitButton = screen.getByRole("button", { name: /submit for evaluation/i });
      expect(submitButton).toBeEnabled();

      await user.upload(
        screen.getAllByTestId("attachment-file-input")[0],
        new File(["%PDF-"], "report.pdf", { type: "application/pdf" }),
      );

      expect(submitButton).toBeDisabled();
      finishUpload({ upload_id: "upload-1", filename: "report.pdf", content_type: "application/pdf", remaining: 2 });
      await waitFor(() => expect(submitButton).toBeEnabled());
    });

    it("submit modal keeps the original copy when uploads are disabled", async () => {
      const dialogWithoutUploads = await openSubmitDialog(UPLOADS_DISABLED);
      expect(dialogWithoutUploads).toHaveTextContent("your current response will be scored.");
    });

    it("report card shows final_submission_attachments", async () => {
      const payload = makePayload();
      payload.initial_state = {
        ...payload.initial_state,
        finished: true,
        final_report: {
          report_html: '<section class="coach-report-submission"><p>student answer</p></section>',
          evaluation_markdown: "Good job",
          final_submission: "student answer",
          final_submission_attachments: [
            { upload_id: "upload-1", filename: "essay.pdf", content_type: "application/pdf" },
          ],
          finished: true,
          show_report_card: true,
          attempts: { attempts_remaining: 0, attempts_used: 3, can_retry: false, max_attempts: 3 },
        },
      };

      const { container } = render(<CoachingStudentApp payload={payload} />);

      expect(await screen.findByText("essay.pdf")).toBeInTheDocument();
      expect(container.querySelector(".coach-report-submission")).toHaveTextContent("essay.pdf");
    });

    it("coach chips stack vertically", () => {
      const attachment = { upload_id: "upload-1", filename: "notes.txt", content_type: "text/plain" as const };
      const learnerMessage = (pane: string) => ({
        character: { name: "", avatar: "", pane, role: "user" },
        content: "",
        is_user: true,
        pane,
        attachments: [{ ...attachment, upload_id: pane }],
      });
      const payload = makePayload();
      payload.initial_state = {
        ...payload.initial_state,
        chat_histories: [[learnerMessage("workspace")], [learnerMessage("coach")]],
      };

      const { container } = render(<CoachingStudentApp payload={payload} />);

      const workspaceChips = container.querySelector('[data-pane="workspace"] .attachment-chips');
      const coachChips = container.querySelector('[data-pane="coach"] .attachment-chips');
      expect(workspaceChips).not.toHaveClass("attachment-chips--stacked");
      expect(coachChips).toHaveClass("attachment-chips--stacked");
    });

    it("disables removing files while the conversation resets", async () => {
      mockUploadLearnerFile.mockResolvedValue({
        upload_id: "upload-1", filename: "report.pdf", content_type: "application/pdf", remaining: 2,
      });
      mockResetAll.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      const payload = makePayload();
      payload.initial_state = { ...payload.initial_state, uploads: UPLOADS_ENABLED };
      render(<CoachingStudentApp payload={payload} />);

      await user.upload(
        screen.getAllByTestId("attachment-file-input")[0],
        new File(["%PDF-"], "report.pdf", { type: "application/pdf" }),
      );
      await screen.findByRole("button", { name: "Remove report.pdf" });
      await user.click(screen.getByRole("button", { name: /start again/i }));
      await user.click(screen.getByRole("button", { name: /start over/i }));

      expect(screen.getByText("report.pdf")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove report.pdf" })).not.toBeInTheDocument();
      for (const uploadButton of screen.getAllByRole("button", { name: /upload file/i })) {
        expect(uploadButton).toBeDisabled();
      }
    });

    it("sends the coach pane's uploaded files and keeps them after a failed send", async () => {
      mockUploadLearnerFile.mockResolvedValue({
        upload_id: "upload-1", filename: "notes.txt", content_type: "text/plain", remaining: 2,
      });
      mockSendChatMessage.mockRejectedValue(new Error("LLM unavailable"));
      const user = userEvent.setup();
      const payload = makePayload();
      payload.initial_state = { ...payload.initial_state, uploads: UPLOADS_ENABLED };
      render(<CoachingStudentApp payload={payload} />);

      const coachFileInput = screen.getAllByTestId("attachment-file-input")[1];
      await user.upload(coachFileInput, new File(["notes"], "notes.txt", { type: "text/plain" }));
      const sendToCoach = screen.getByRole("button", { name: "Send message to coach" });
      await waitFor(() => expect(sendToCoach).toBeEnabled());
      await user.click(sendToCoach);

      expect(mockUploadLearnerFile).toHaveBeenCalledWith("/handler/upload_file", "coach", expect.any(File));
      expect(mockSendChatMessage).toHaveBeenCalledWith("/handler/get_character_response", 1, "", ["upload-1"]);
      expect(await screen.findByText(/llm unavailable/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeInTheDocument();
    });

    it("drops the coach pane's chips when the send is rejected because the uploads are gone", async () => {
      mockUploadLearnerFile.mockResolvedValue({
        upload_id: "upload-1", filename: "notes.txt", content_type: "text/plain", remaining: 2,
      });
      mockSendChatMessage.mockRejectedValue(
        new RequestError("Invalid upload.", 400, { code: "invalid_upload", error: "Invalid upload." }),
      );
      mockDeleteLearnerUpload.mockResolvedValue({ remaining: 3 });
      const user = userEvent.setup();
      const payload = makePayload();
      payload.initial_state = { ...payload.initial_state, uploads: UPLOADS_ENABLED };
      render(<CoachingStudentApp payload={payload} />);

      const coachFileInput = screen.getAllByTestId("attachment-file-input")[1];
      await user.upload(coachFileInput, new File(["notes"], "notes.txt", { type: "text/plain" }));
      const sendToCoach = screen.getByRole("button", { name: "Send message to coach" });
      await waitFor(() => expect(sendToCoach).toBeEnabled());
      await user.click(sendToCoach);

      expect(await screen.findByText(/invalid upload/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove notes.txt" })).not.toBeInTheDocument();
      expect(mockDeleteLearnerUpload).toHaveBeenCalledWith("/handler/delete_upload", "coach", "upload-1");
    });
  });
});
