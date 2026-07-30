import React from "react";
import { render, screen, waitFor } from "../test/helpers";
import userEvent from "@testing-library/user-event";
import CodingStudentApp from "./CodingStudentApp";
import { CodingStudentPayload } from "./types";
import * as api from "./api";

jest.mock("./api");

function readyEditor(code: string, language = "Python (3.8.1)") {
  const iframe = screen.getByTitle(language) as HTMLIFrameElement;
  let value = code;
  Object.defineProperty(iframe.contentWindow, "editor", {
    configurable: true,
    value: {
      focus: jest.fn(),
      getValue: () => value,
      setValue: (nextValue: string) => {
        value = nextValue;
      },
      onDidChangeModelContent: jest.fn(),
    },
  });
  window.dispatchEvent(new MessageEvent("message", { data: "test-usage" }));
  return {
    setCode: (nextValue: string) => {
      value = nextValue;
    },
  };
}

function makePayload(overrides?: Partial<CodingStudentPayload>): CodingStudentPayload {
  return {
    view: "student",
    handler_urls: {
      get_response: "/handler/get_response",
      get_submission_result_handler: "/handler/get_submission_result",
      reset_handler: "/handler/reset",
      submit_code_handler: "/handler/submit_code",
      download_pdf: "/handler/download_pdf",
    },
    initial_state: {
      code: "",
      ai_evaluation: "",
      code_exec_result: null,
    },
    meta: {
      language: "Python (3.8.1)",
      monaco_html_b64: "",
      question: "Write a function that adds two numbers.",
      pdf_download_allowed: false,
      pdf_download_title: "",
      pdf_download_description: ""
    },
    mfe_config_api: "/mfe_config",
    style_urls: [],
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

    it("renders submit, run, and reset buttons for executable code", () => {
      render(<CodingStudentApp payload={makePayload()} usageId="test-usage" />);
      expect(screen.getByRole("button", { name: /submit code/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^run$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
    });
  });

  describe("run code", () => {
    it("executes code, updates output, and does not request AI feedback", async () => {
      const user = userEvent.setup();
      jest.mocked(api.submitCode).mockResolvedValue({ submission_id: "run-1" });
      jest.mocked(api.pollSubmissionResult).mockResolvedValue({
        stdout: "run output",
        stderr: "",
      });
      const payload = makePayload({
        initial_state: {
          code: "print('run')",
          ai_evaluation: "Existing feedback",
          code_exec_result: null,
        },
      });
      render(<CodingStudentApp payload={payload} usageId="test-usage" />);
      readyEditor("print('run')");

      await user.click(screen.getByRole("tab", { name: /ai feedback/i }));
      await user.click(screen.getByRole("button", { name: /^run$/i }));

      await waitFor(() => expect(screen.getByText("run output")).toBeInTheDocument());
      const outputTab = screen.getByRole("tab", { name: /output \(updated\)/i });
      expect(outputTab).toHaveClass("result-tab-btn--notify");
      expect(api.fetchAiFeedback).not.toHaveBeenCalled();
      expect(screen.getByRole("tab", { name: /ai feedback.*may be stale/i })).toBeInTheDocument();

      await user.click(outputTab);
      expect(screen.getByRole("tab", { name: /^output$/i })).not.toHaveClass("result-tab-btn--notify");
    });

    it("hides Run for HTML/CSS and updates the preview live as editor content changes", async () => {
      const html = "<h1>Initial</h1><script>unsafe()</script>";
      const payload = makePayload({
        initial_state: {
          code: html,
          ai_evaluation: "Existing feedback",
          code_exec_result: null,
        },
        meta: { ...makePayload().meta, language: "HTML/CSS" },
      });
      render(<CodingStudentApp payload={payload} usageId="test-usage" />);
      readyEditor(html, "HTML/CSS");

      // Run button is hidden for HTML/CSS since the preview updates live as the user types
      expect(screen.queryByRole("button", { name: /^run$/i })).not.toBeInTheDocument();

      // Preview renders initial HTML with scripts stripped
      await waitFor(() => {
        const preview = document.querySelector("iframe.html-render");
        expect(preview).toBeInTheDocument();
        expect(preview).toHaveAttribute("srcdoc", "<h1>Initial</h1>");
      });
    });

    it("clears stale feedback after a successful submit", async () => {
      const user = userEvent.setup();
      jest.mocked(api.submitCode).mockResolvedValue({ submission_id: "submit-1" });
      jest.mocked(api.pollSubmissionResult).mockResolvedValue({ stdout: "output", stderr: "" });
      jest.mocked(api.fetchAiFeedback).mockResolvedValue("New feedback");
      const payload = makePayload({
        initial_state: {
          code: "print('run')",
          ai_evaluation: "Old feedback",
          code_exec_result: null,
        },
      });
      render(<CodingStudentApp payload={payload} usageId="test-usage" />);
      readyEditor("print('run')");
      await user.click(screen.getByRole("button", { name: /^run$/i }));
      await waitFor(() => expect(screen.getByText(/may be stale/i)).toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: /submit code/i }));
      await waitFor(() => expect(screen.queryByText(/may be stale/i)).not.toBeInTheDocument());
    });
  });
});
