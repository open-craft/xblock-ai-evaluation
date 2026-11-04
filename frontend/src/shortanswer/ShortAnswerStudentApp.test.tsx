import React from "react";
import { render, screen, waitFor } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import ShortAnswerStudentApp from "./ShortAnswerStudentApp";
import { ShortAnswerStudentPayload, ShortAnswerUploads } from "./types";
import * as api from "./api";
import * as uploadApi from "../shared/api";
import { RequestError } from "../shared/request";

jest.mock("./api");
jest.mock("../shared/api");

const mockSendAnswer = api.sendAnswer as jest.MockedFunction<typeof api.sendAnswer>;
const mockResetChat = api.resetChat as jest.MockedFunction<typeof api.resetChat>;
const mockUploadLearnerFile = uploadApi.uploadLearnerFile as jest.MockedFunction<typeof uploadApi.uploadLearnerFile>;
const mockDeleteLearnerUpload = uploadApi.deleteLearnerUpload as jest.MockedFunction<
  typeof uploadApi.deleteLearnerUpload
>;

const UPLOADS_DISABLED: ShortAnswerUploads = {
  shortanswer: { enabled: false },
  pdf_max_bytes: 4194304,
  pdf_max_pages: 10,
  text_max_bytes: 51200,
  accept: ".pdf,.txt,.md,.csv",
};

function makePayload(overrides?: Partial<ShortAnswerStudentPayload>): ShortAnswerStudentPayload {
  return {
    view: "student",
    handler_urls: {
      get_response: "/handler/get_response",
      reset: "/handler/reset",
      download_pdf: "/handler/download_pdf",
      upload_file: "/handler/upload_file",
      delete_upload: "/handler/delete_upload",
    },
    initial_state: {
      messages: null,
      uploads: UPLOADS_DISABLED,
    },
    meta: {
      title: "",
      allow_reset: true,
      character_image: "",
      character_limit: 1000,
      max_responses: 10,
      question: "What is 2+2?",
      hide_question: false,
      pdf_download_allowed: false,
      pdf_download_title: "",
      pdf_download_description: ""
    },
    mfe_config_api: "/mfe_config",
    style_urls: [],
    ...overrides,
  };
}

describe("ShortAnswerStudentApp", () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders question text", () => {
      render(<ShortAnswerStudentApp payload={makePayload()} />);
      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    });

    it("renders existing messages", () => {
      const payload = makePayload({
        initial_state: {
          messages: [
            { source: "user", content: "four" },
            { source: "llm", content: "Correct!" },
          ],
          uploads: UPLOADS_DISABLED,
        },
      });
      render(<ShortAnswerStudentApp payload={payload} />);
      expect(screen.getByText("four")).toBeInTheDocument();
      expect(screen.getByText("Correct!")).toBeInTheDocument();
    });
  });

  describe("character limit", () => {
    it("applies the configured limit to the textarea", () => {
      const payload = makePayload();
      payload.meta.character_limit = 2000;

      render(<ShortAnswerStudentApp payload={payload} />);

      expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "2000");
    });
  });

  describe("submit answer", () => {
    it("keeps submit disabled until the learner types an answer", async () => {
      const user = userEvent.setup();

      render(<ShortAnswerStudentApp payload={makePayload()} />);

      const textarea = screen.getByRole("textbox");
      const submitButton = screen.getByRole("button", { name: /submit/i });

      expect(submitButton).toBeDisabled();

      await user.type(textarea, "my answer");

      expect(submitButton).toBeEnabled();
    });

    it("keeps submit disabled for whitespace-only text without files", async () => {
      const user = userEvent.setup();

      render(<ShortAnswerStudentApp payload={makePayload()} />);

      await user.type(screen.getByRole("textbox"), "   ");

      expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    });

    it("sends user input on submit", async () => {
      mockSendAnswer.mockResolvedValue("Good answer!");
      const user = userEvent.setup();

      render(<ShortAnswerStudentApp payload={makePayload()} />);

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "my answer");

      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockSendAnswer).toHaveBeenCalledWith("/handler/get_response", "my answer", []);
      });
    });

    it("displays user message immediately", async () => {
      mockSendAnswer.mockResolvedValue("response");
      const user = userEvent.setup();

      render(<ShortAnswerStudentApp payload={makePayload()} />);

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "my answer");

      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);

      expect(screen.getByText("my answer")).toBeInTheDocument();
    });

    it("displays LLM response after API call", async () => {
      mockSendAnswer.mockResolvedValue("The answer is 4.");
      const user = userEvent.setup();

      render(<ShortAnswerStudentApp payload={makePayload()} />);

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "four");

      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("The answer is 4.")).toBeInTheDocument();
      });
    });
  });

  describe("reset", () => {
    it("keeps reset disabled until the conversation has a user message", () => {
      render(<ShortAnswerStudentApp payload={makePayload()} />);

      expect(screen.getByRole("button", { name: /reset chat/i })).toBeDisabled();
    });

    it("clears messages after reset", async () => {
      mockResetChat.mockResolvedValue({ remaining: {} });
      const user = userEvent.setup();

      const payload = makePayload({
        initial_state: {
          messages: [
            { source: "user", content: "old message" },
            { source: "llm", content: "old reply" },
          ],
          uploads: UPLOADS_DISABLED,
        },
      });

      render(<ShortAnswerStudentApp payload={payload} />);

      expect(screen.getByText("old message")).toBeInTheDocument();

      const resetButton = screen.getByRole("button", { name: /reset chat/i });
      await user.click(resetButton);

      const confirmResetBtn = screen.getByRole("button", { name: /start over/i });
      await user.click(confirmResetBtn);

      await waitFor(() => {
        expect(screen.queryByText("old message")).not.toBeInTheDocument();
      });
    });

    it("does not render reset button when allow_reset is false", () => {
      const payload = makePayload({
        initial_state: {
          messages: [
            { source: "user", content: "msg" },
            { source: "llm", content: "reply" },
          ],
          uploads: UPLOADS_DISABLED,
        },
        meta: {
          title: "",
          allow_reset: false,
          character_image: "",
          character_limit: 1000,
          max_responses: 10,
          question: "test",
          hide_question: false,
          pdf_download_allowed: false,
          pdf_download_title: "",
          pdf_download_description: ""
        },
      });

      render(<ShortAnswerStudentApp payload={payload} />);

      const buttons = screen.getAllByRole("button");
      const resetButton = buttons.find((b) => /reset/i.test(b.textContent || ""));
      expect(resetButton).toBeUndefined();
    });
  });

  describe("test collapsible question information", () => {
    it("question information collapses when first message sent", async () => {
      mockSendAnswer.mockResolvedValue("response");
      const user = userEvent.setup();

      const payload = makePayload();
      payload.meta.question = `
collapsible question

This is paragraph one.

And this is paragraph two.`;

      render(<ShortAnswerStudentApp payload={payload} />);

      const collapsibleTrigger = screen.getByRole("button", { name: /collapsible question/i });
      // should be open by default for new conversations
      expect(collapsibleTrigger.getAttribute('aria-expanded')).toBe("true");

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "my answer");

      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);

      expect(screen.getByText("my answer")).toBeInTheDocument();
      expect(collapsibleTrigger.getAttribute('aria-expanded')).toBe("false");
    });

    it("question information does not collapse when more messages sent", async () => {
      mockSendAnswer.mockResolvedValue("response");
      const user = userEvent.setup();

      const payload = makePayload({
        initial_state: {
          messages: [
            { source: "user", content: "four" },
            { source: "llm", content: "Correct!" },
          ],
          uploads: UPLOADS_DISABLED,
        },
      });
      payload.meta.question = `
collapsible question

This is paragraph one.

And this is paragraph two.`;

      render(<ShortAnswerStudentApp payload={payload} />);

      // collapsible question text should be collapsed by default when there is already a conversation in progress
      const collapsibleTrigger = screen.getByRole("button", { name: /collapsible question/i });
      expect(collapsibleTrigger.getAttribute('aria-expanded')).toBe("false");

      // manually expand it
      await user.click(collapsibleTrigger);
      expect(collapsibleTrigger.getAttribute('aria-expanded')).toBe("true");

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "my answer");

      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);

      expect(screen.getByText("my answer")).toBeInTheDocument();
      // collapsible should not get auto-closed, when messages are sent (other than the first message in the conversation)
      expect(collapsibleTrigger.getAttribute('aria-expanded')).toBe("true");
    });

    it("question information expands after reset", async () => {
      mockResetChat.mockResolvedValue({ remaining: {} });
      const user = userEvent.setup();

      const payload = makePayload({
        initial_state: {
          messages: [
            { source: "user", content: "old message" },
            { source: "llm", content: "old reply" },
          ],
          uploads: UPLOADS_DISABLED,
        },
      });
      payload.meta.question = `
collapsible question

This is paragraph one.

And this is paragraph two.`;

      render(<ShortAnswerStudentApp payload={payload} />);

      const collapsibleTrigger = screen.getByRole("button", { name: /collapsible question/i });
      expect(collapsibleTrigger.getAttribute('aria-expanded')).toBe("false");

      expect(screen.getByText("old message")).toBeInTheDocument();

      const resetButton = screen.getByRole("button", { name: /reset chat/i });
      await user.click(resetButton);

      const confirmResetBtn = screen.getByRole("button", { name: /start over/i });
      await user.click(confirmResetBtn);

      await waitFor(() => {
        expect(screen.queryByText("old message")).not.toBeInTheDocument();
        // should auto-expand after reset
        expect(collapsibleTrigger.getAttribute('aria-expanded')).toBe("true");
      });
    });
  });

  describe("error handling", () => {
    it("shows a user friendly error alert on network error", async () => {
      mockSendAnswer.mockImplementation(async () => {
        throw new Error("error code 418");
      });
      const user = userEvent.setup();

      const payload = makePayload();
      render(<ShortAnswerStudentApp payload={payload} />);

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "my answer");

      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);

      // here we expect to see the error alert with friendly message and the original error message
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/please try again/i)).toBeVisible();
      expect(screen.getByText(/error code 418/i)).toBeVisible();

      const closeButton = screen.getByRole("button", { name: /dismiss/i });
      await user.click(closeButton);

      // and the error modal should be dismissed now
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(/please try again/i)).toBeNull();
      expect(screen.queryByText(/error code 418/i)).toBeNull();


    });
  });

  describe("file uploads", () => {
    const UPLOADS_ENABLED: ShortAnswerUploads = {
      ...UPLOADS_DISABLED,
      shortanswer: { enabled: true, limit: 3, remaining: 3 },
    };

    it("renders chips on sent messages", () => {
      const payload = makePayload({
        initial_state: {
          messages: [
            {
              source: "user",
              content: "see attached",
              attachments: [{ upload_id: "upload-1", filename: "report.pdf", content_type: "application/pdf" }],
            },
            { source: "llm", content: "Thanks!" },
            {
              source: "user",
              content: "",
              attachments: [{ upload_id: "upload-2", filename: "data.csv", content_type: "text/csv" }],
            },
          ],
          uploads: UPLOADS_DISABLED,
        },
      });

      render(<ShortAnswerStudentApp payload={payload} />);

      expect(screen.getByText("report.pdf")).toBeInTheDocument();
      expect(screen.getByText("PDF")).toBeInTheDocument();
      expect(screen.getByText("see attached")).toBeInTheDocument();
      expect(screen.getByText("data.csv")).toBeInTheDocument();
      expect(screen.getAllByRole("list", { name: "Attached files" })).toHaveLength(2);
    });

    it("sends a file-only message with its upload IDs", async () => {
      mockUploadLearnerFile.mockResolvedValue({
        upload_id: "upload-1", filename: "report.pdf", content_type: "application/pdf", remaining: 2,
      });
      mockSendAnswer.mockResolvedValue("Nice report.");
      const user = userEvent.setup();
      render(<ShortAnswerStudentApp payload={makePayload({
        initial_state: { messages: null, uploads: UPLOADS_ENABLED },
      })} />);

      await user.upload(
        screen.getByTestId("attachment-file-input"),
        new File(["%PDF-"], "report.pdf", { type: "application/pdf" }),
      );
      const submitButton = screen.getByRole("button", { name: /submit/i });
      await waitFor(() => expect(submitButton).toBeEnabled());
      await user.click(submitButton);

      expect(mockSendAnswer).toHaveBeenCalledWith("/handler/get_response", "", ["upload-1"]);
      expect(await screen.findByText("Nice report.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove report.pdf" })).not.toBeInTheDocument();
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });

    it("keeps files uploaded while a message was sending when the send fails", async () => {
      mockUploadLearnerFile
        .mockResolvedValueOnce({
          upload_id: "upload-1", filename: "first.pdf", content_type: "application/pdf", remaining: 2,
        })
        .mockResolvedValueOnce({
          upload_id: "upload-2", filename: "second.pdf", content_type: "application/pdf", remaining: 1,
        });
      let failSend: (error: Error) => void = () => {};
      mockSendAnswer.mockReturnValue(new Promise((_resolve, reject) => {
        failSend = reject;
      }));
      const user = userEvent.setup();
      render(<ShortAnswerStudentApp payload={makePayload({
        initial_state: { messages: null, uploads: UPLOADS_ENABLED },
      })} />);
      const fileInput = screen.getByTestId("attachment-file-input");

      await user.upload(fileInput, new File(["%PDF-"], "first.pdf", { type: "application/pdf" }));
      await waitFor(() => expect(screen.getByRole("button", { name: /submit/i })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: /submit/i }));
      await user.upload(fileInput, new File(["%PDF-"], "second.pdf", { type: "application/pdf" }));
      await screen.findByRole("button", { name: "Remove second.pdf" });
      failSend(new Error("LLM unavailable"));

      expect(await screen.findByRole("button", { name: "Remove first.pdf" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove second.pdf" })).toBeInTheDocument();
    });

    it("keeps chips after failed send", async () => {
      mockUploadLearnerFile.mockResolvedValue({
        upload_id: "upload-1", filename: "report.pdf", content_type: "application/pdf", remaining: 2,
      });
      mockSendAnswer.mockRejectedValue(new Error("LLM unavailable"));
      const user = userEvent.setup();
      render(<ShortAnswerStudentApp payload={makePayload({
        initial_state: { messages: null, uploads: UPLOADS_ENABLED },
      })} />);

      await user.upload(
        screen.getByTestId("attachment-file-input"),
        new File(["%PDF-"], "report.pdf", { type: "application/pdf" }),
      );
      await user.type(screen.getByRole("textbox"), "my answer");
      await waitFor(() => expect(screen.getByRole("button", { name: /submit/i })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: /submit/i }));

      expect(await screen.findByText(/llm unavailable/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove report.pdf" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /submit/i })).toBeEnabled();
    });

    it("disables uploading and removing files while the chat resets", async () => {
      mockUploadLearnerFile.mockResolvedValue({
        upload_id: "upload-1", filename: "report.pdf", content_type: "application/pdf", remaining: 2,
      });
      let finishReset: (response: Awaited<ReturnType<typeof api.resetChat>>) => void = () => {};
      mockResetChat.mockReturnValue(new Promise((resolve) => {
        finishReset = resolve;
      }));
      const user = userEvent.setup();
      render(<ShortAnswerStudentApp payload={makePayload({
        initial_state: {
          messages: [
            { source: "user", content: "old message" },
            { source: "llm", content: "old reply" },
          ],
          uploads: UPLOADS_ENABLED,
        },
      })} />);

      await user.upload(
        screen.getByTestId("attachment-file-input"),
        new File(["%PDF-"], "report.pdf", { type: "application/pdf" }),
      );
      await screen.findByRole("button", { name: "Remove report.pdf" });
      await user.click(screen.getByRole("button", { name: /reset chat/i }));
      await user.click(screen.getByRole("button", { name: /start over/i }));

      expect(screen.getByRole("button", { name: "Upload file: 2 remaining" })).toBeDisabled();
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove report.pdf" })).not.toBeInTheDocument();

      finishReset({ remaining: { shortanswer: 3 } });

      await waitFor(() => expect(screen.getByRole("button", { name: "Upload file: 3 remaining" })).toBeEnabled());
      expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();
    });

    it("drops chips when the send is rejected because the uploads are gone", async () => {
      mockUploadLearnerFile.mockResolvedValue({
        upload_id: "upload-1", filename: "report.pdf", content_type: "application/pdf", remaining: 2,
      });
      mockSendAnswer.mockRejectedValue(
        new RequestError("Invalid upload.", 400, { code: "invalid_upload", error: "Invalid upload." }),
      );
      mockDeleteLearnerUpload.mockRejectedValue(
        new RequestError("Invalid upload.", 400, { code: "invalid_upload", error: "Invalid upload." }),
      );
      const user = userEvent.setup();
      render(<ShortAnswerStudentApp payload={makePayload({
        initial_state: { messages: null, uploads: UPLOADS_ENABLED },
      })} />);

      await user.upload(
        screen.getByTestId("attachment-file-input"),
        new File(["%PDF-"], "report.pdf", { type: "application/pdf" }),
      );
      await user.type(screen.getByRole("textbox"), "my answer");
      await waitFor(() => expect(screen.getByRole("button", { name: /submit/i })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: /submit/i }));

      expect(await screen.findByText(/invalid upload/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove report.pdf" })).not.toBeInTheDocument();
      expect(mockDeleteLearnerUpload).toHaveBeenCalledWith("/handler/delete_upload", "shortanswer", "upload-1");
      expect(screen.getByRole("textbox")).toHaveValue("my answer");
    });
  });
});
