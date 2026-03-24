import { makeXBlockInitializer } from "../shared/mountApp";
import { XBlockElementLike, XBlockRuntime } from "../shared/types";
import CodingStudentApp from "./CodingStudentApp";
import { CodingExecutionResult, CodingStudentPayload } from "./types";

type CodingPayloadInput = Partial<CodingStudentPayload> & {
  ai_evaluation?: unknown;
  code?: string;
  code_exec_result?: unknown;
  language?: string;
  marked_html?: string;
  monaco_html?: string;
  question?: string;
};

function normalizePayload(
  runtime: XBlockRuntime,
  element: XBlockElementLike,
  data: unknown,
): CodingStudentPayload {
  const payloadData = (data || {}) as CodingPayloadInput;
  const fallbackInitialState: CodingStudentPayload["initial_state"] = {
    code: payloadData.code,
    ai_evaluation: payloadData.ai_evaluation,
    code_exec_result: payloadData.code_exec_result as CodingExecutionResult | undefined,
  };

  return {
    view: payloadData.view || "student",
    handler_urls: payloadData.handler_urls || {
      submit_code_handler: runtime.handlerUrl(element, "submit_code_handler"),
      get_submission_result_handler: runtime.handlerUrl(
        element,
        "get_submission_result_handler",
      ),
      get_response: runtime.handlerUrl(element, "get_response"),
      reset_handler: runtime.handlerUrl(element, "reset_handler"),
    },
    initial_state: payloadData.initial_state || fallbackInitialState,
    meta: payloadData.meta || {
      question: payloadData.question,
      language: payloadData.language,
      monaco_html: payloadData.monaco_html,
      marked_html: payloadData.marked_html,
    },
  };
}

function resolveUsageId(element: XBlockElementLike) {
  if (element instanceof Element) {
    return element.getAttribute("data-usage") || element.getAttribute("data-usage-id") || "";
  }

  const rootElement = element?.[0];
  if (rootElement instanceof Element) {
    return (
      rootElement.getAttribute("data-usage") || rootElement.getAttribute("data-usage-id") || ""
    );
  }

  return "";
}

const initializer = makeXBlockInitializer(
  CodingStudentApp,
  (runtime, element, data) => {
    const usageId = resolveUsageId(element);

    if (!usageId) {
      throw new Error("XBlock is missing a usage ID attribute on its root HTML node.");
    }

    return {
      payload: normalizePayload(runtime, element, data),
      usageId,
    };
  },
);

const globalWindow = window as Window & {
  CodingAIEvalXBlock?: typeof initializer;
};

globalWindow.CodingAIEvalXBlock = initializer;
