import React from "react";
import { render, screen, waitFor } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import ShortAnswerStudentApp from "./ShortAnswerStudentApp";
import { ShortAnswerStudentPayload } from "./types";
import * as api from "./api";

jest.mock("./api");

const mockSendAnswer = api.sendAnswer as jest.MockedFunction<typeof api.sendAnswer>;
const mockResetChat = api.resetChat as jest.MockedFunction<typeof api.resetChat>;

function makePayload(overrides?: Partial<ShortAnswerStudentPayload>): ShortAnswerStudentPayload {
  return {
    view: "student",
    handler_urls: {
      get_response: "/handler/get_response",
      reset: "/handler/reset",
    },
    initial_state: {
      messages: null,
    },
    meta: {
      allow_reset: true,
      character_image: "",
      max_responses: 10,
      question: "What is 2+2?",
      hide_question: false,
    },
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
          allow_reset: false,
          character_image: "",
          max_responses: 10,
          question: "test",
          hide_question: false,
        },
      });

      render(<ShortAnswerStudentApp payload={payload} />);

      const buttons = screen.getAllByRole("button");
      const resetButton = buttons.find((b) => /reset/i.test(b.textContent || ""));
      expect(resetButton).toBeUndefined();
    });
  });
});
