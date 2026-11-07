import React from "react";
import { render, screen, waitFor } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import ShortAnswerStudentApp from "./ShortAnswerStudentApp";
import { ShortAnswerStudentPayload } from "./types";
import * as api from "./api";
import { BACKGROUND_OPTIONS, getBackgroundOption } from "./appearance";

jest.mock("./api");

const mockSendAnswer = api.sendAnswer as jest.MockedFunction<typeof api.sendAnswer>;
const mockResetChat = api.resetChat as jest.MockedFunction<typeof api.resetChat>;

function makePayload(overrides?: Partial<ShortAnswerStudentPayload>): ShortAnswerStudentPayload {
  return {
    view: "student",
    handler_urls: {
      get_response: "/handler/get_response",
      reset: "/handler/reset",
      download_pdf: "/handler/download_pdf",
    },
    initial_state: {
      messages: null,
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
        },
      });
      render(<ShortAnswerStudentApp payload={payload} />);
      expect(screen.getByText("four")).toBeInTheDocument();
      expect(screen.getByText("Correct!")).toBeInTheDocument();
    });
  });

  describe("appearance", () => {
    it.each([undefined, "", "   "])("uses the default header for title %p", (title) => {
      const payload = makePayload();
      payload.meta.title = title as unknown as string;
      render(<ShortAnswerStudentApp payload={payload} />);
      expect(screen.getByRole("heading", { name: "AI Discussion" })).toBeVisible();
    });

    it("keeps the header title when the question is hidden", () => {
      const payload = makePayload();
      payload.meta.title = "Reflect on your learning";
      const { rerender } = render(<ShortAnswerStudentApp payload={payload} />);
      expect(screen.getByRole("heading", { name: "Reflect on your learning" })).toBeVisible();
      rerender(<ShortAnswerStudentApp payload={{ ...payload, meta: { ...payload.meta, hide_question: true } }} />);
      expect(screen.getByRole("heading", { name: "Reflect on your learning" })).toBeVisible();
      expect(screen.queryByText("What is 2+2?")).not.toBeInTheDocument();
    });

    it("renders the title as text and keeps a constant decorative icon", () => {
      const payload = makePayload();
      const { container, rerender } = render(<ShortAnswerStudentApp payload={payload} />);
      const icon = container.querySelector(".shortanswer-header-icon")!;
      const initialIcon = icon.innerHTML;
      expect(icon).toHaveAttribute("aria-hidden", "true");
      payload.meta.title = "<img src=x onerror=alert(1)>";
      payload.meta.character_image = "/avatar.png";
      rerender(<ShortAnswerStudentApp payload={{ ...payload }} />);
      expect(screen.getByRole("heading", { name: payload.meta.title })).toBeVisible();
      expect(container.querySelector(".shortanswer-header-title img")).toBeNull();
      expect(icon.innerHTML).toBe(initialIcon);
      expect(container.querySelector(".shortanswer-character img")).toHaveAttribute("src", "/avatar.png");
    });

    it.each(BACKGROUND_OPTIONS)("selects the $value theme without persisting a color", (option) => {
      const payload = makePayload();
      payload.meta.background_theme = option.value;
      render(<ShortAnswerStudentApp payload={payload} />);
      expect(screen.getByRole("region", { name: "AI Discussion" }))
        .toHaveAttribute("data-background-theme", option.value);
      expect(getBackgroundOption(option.value).color).toBe(option.color);
      expect(option.color).toMatch(/^var\(/);
    });

    it.each([undefined, "", "removed-theme", "url(https://example.com)"])("falls back safely for %p", (value) => {
      const payload = makePayload();
      payload.meta.background_theme = value;
      render(<ShortAnswerStudentApp payload={payload} />);
      expect(screen.getByRole("region", { name: "AI Discussion" }))
        .toHaveAttribute("data-background-theme", "default");
      expect(getBackgroundOption(value)).toBe(BACKGROUND_OPTIONS[0]);
    });

    it("resets only the selected block when multiple blocks share a page", async () => {
      mockResetChat.mockResolvedValue({});
      const user = userEvent.setup();
      const first = makePayload({ initial_state: { messages: [{ source: "user", content: "First answer" }] } });
      const second = makePayload({ initial_state: { messages: [{ source: "user", content: "Second answer" }] } });
      render(<><ShortAnswerStudentApp payload={first} /><ShortAnswerStudentApp payload={second} /></>);
      const headings = screen.getAllByRole("heading", { name: "AI Discussion" });
      expect(headings[0].id).not.toBe(headings[1].id);
      await user.click(screen.getAllByRole("button", { name: "Reset chat" })[0]);
      await user.click(screen.getByRole("button", { name: "Restart" }));
      await waitFor(() => expect(screen.queryByText("First answer")).not.toBeInTheDocument());
      expect(screen.getByText("Second answer")).toBeVisible();
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

    it("sends user input on submit", async () => {
      mockSendAnswer.mockResolvedValue("Good answer!");
      const user = userEvent.setup();

      render(<ShortAnswerStudentApp payload={makePayload()} />);

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "my answer");

      const submitButton = screen.getByRole("button", { name: /submit/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockSendAnswer).toHaveBeenCalledWith("/handler/get_response", "my answer");
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
    it("shows the Figma restart confirmation copy", async () => {
      const user = userEvent.setup();
      const payload = makePayload({ initial_state: { messages: [{ source: "user", content: "Keep this" }] } });
      render(<ShortAnswerStudentApp payload={payload} />);
      await user.click(screen.getByRole("button", { name: "Reset chat" }));
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(screen.getByRole("heading", { name: "Restart interactive?" })).toBeVisible();
      expect(screen.getByText("If you restart, your progress in this interactive will be lost.")).toBeVisible();
      expect(screen.getByRole("button", { name: "Restart" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Stay" })).toBeVisible();
    });

    it("places reset in the header and cancellation keeps the conversation", async () => {
      const user = userEvent.setup();
      const payload = makePayload({ initial_state: { messages: [{ source: "user", content: "Keep this" }] } });
      render(<ShortAnswerStudentApp payload={payload} />);
      const button = screen.getByRole("button", { name: "Reset chat" });
      expect(button.closest("header")).not.toBeNull();
      await user.click(button);
      expect(mockResetChat).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Stay" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByText("Keep this")).toBeVisible();
      expect(mockResetChat).not.toHaveBeenCalled();
    });

    it("preserves messages when reset fails", async () => {
      mockResetChat.mockRejectedValue(new Error("Reset failed"));
      const user = userEvent.setup();
      render(<ShortAnswerStudentApp payload={makePayload({
        initial_state: { messages: [{ source: "user", content: "Keep this" }] },
      })} />);
      await user.click(screen.getByRole("button", { name: "Reset chat" }));
      await user.click(screen.getByRole("button", { name: "Restart" }));
      await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
      expect(screen.getByText("Keep this")).toBeVisible();
      expect(screen.getByRole("button", { name: "Reset chat" })).toBeEnabled();
    });

    it("keeps reset disabled until the conversation has a user message", () => {
      render(<ShortAnswerStudentApp payload={makePayload()} />);

      expect(screen.getByRole("button", { name: /reset chat/i })).toBeDisabled();
    });

    it("clears messages after reset", async () => {
      mockResetChat.mockResolvedValue({});
      const user = userEvent.setup();

      const payload = makePayload({
        initial_state: {
          messages: [
            { source: "user", content: "old message" },
            { source: "llm", content: "old reply" },
          ],
        },
      });

      render(<ShortAnswerStudentApp payload={payload} />);

      expect(screen.getByText("old message")).toBeInTheDocument();

      const resetButton = screen.getByRole("button", { name: /reset chat/i });
      await user.click(resetButton);

      const confirmResetBtn = screen.getByRole("button", { name: /restart/i });
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

      expect(screen.queryByRole("button", { name: /reset chat/i })).not.toBeInTheDocument();
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
      mockResetChat.mockResolvedValue({});
      const user = userEvent.setup();

      const payload = makePayload({
        initial_state: {
          messages: [
            { source: "user", content: "old message" },
            { source: "llm", content: "old reply" },
          ],
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

      const confirmResetBtn = screen.getByRole("button", { name: /restart/i });
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
});
