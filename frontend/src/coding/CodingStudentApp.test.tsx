import React from "react";
import { render, screen, waitFor } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import CodingStudentApp from "./CodingStudentApp";
import { CodingStudentPayload } from "./types";

jest.mock("./api");

function makePayload(overrides?: Partial<CodingStudentPayload>): CodingStudentPayload {
  return {
    view: "student",
    handler_urls: {
      get_response: "/handler/get_response",
      get_submission_result_handler: "/handler/get_submission_result",
      reset_handler: "/handler/reset",
      submit_code_handler: "/handler/submit_code",
    },
    initial_state: {
      code: "",
      ai_evaluation: "",
      code_exec_result: null,
    },
    meta: {
      language: "Python (3.8.1)",
      monaco_html: "",
      question: "Write a function that adds two numbers.",
    },
    ...overrides,
  };
}

describe("CodingStudentApp", () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders question text", () => {
      render(<CodingStudentApp payload={makePayload()} usageId="test-usage" />);
      expect(screen.getByText("Write a function that adds two numbers.")).toBeInTheDocument();
    });

    it("shows output tab by default", () => {
      render(<CodingStudentApp payload={makePayload()} usageId="test-usage" />);
      const outputTab = screen.getByRole("tab", { name: /output/i });
      expect(outputTab).toHaveAttribute("aria-selected", "true");
    });

    it("renders editor iframe", () => {
      render(<CodingStudentApp payload={makePayload()} usageId="test-usage" />);
      const iframe = screen.getByTitle("Python (3.8.1)");
      expect(iframe).toBeInTheDocument();
    });
  });

  describe("tab navigation", () => {
    it("switches to feedback tab on click", async () => {
      const user = userEvent.setup();
      render(<CodingStudentApp payload={makePayload()} usageId="test-usage" />);

      const feedbackTab = screen.getByRole("tab", { name: /ai feedback/i });
      await user.click(feedbackTab);

      expect(feedbackTab).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("initial state", () => {
    it("displays existing AI feedback", () => {
      const payload = makePayload({
        initial_state: {
          code: "print('hello')",
          ai_evaluation: "**Good work!**",
          code_exec_result: { stdout: "hello", stderr: "" },
        },
      });

      render(<CodingStudentApp payload={payload} usageId="test-usage" />);
      expect(screen.getByText("hello")).toBeInTheDocument();
    });

    it("renders submit and reset buttons", () => {
      render(<CodingStudentApp payload={makePayload()} usageId="test-usage" />);
      expect(screen.getByRole("button", { name: /submit code/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
    });
  });
});
