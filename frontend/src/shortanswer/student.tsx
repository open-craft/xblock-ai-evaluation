import { makeXBlockInitializer } from "../shared/mountApp";
import { XBlockElementLike, XBlockRuntime } from "../shared/types";
import ShortAnswerStudentApp from "./ShortAnswerStudentApp";
import { ShortAnswerMessage, ShortAnswerStudentPayload } from "./types";

type ShortAnswerPayloadInput = Partial<ShortAnswerStudentPayload> & {
  allow_reset?: boolean;
  character_image?: string;
  max_responses?: number;
  messages?: unknown[];
  question?: string;
};

function normalizePayload(
  runtime: XBlockRuntime,
  element: XBlockElementLike,
  data: unknown,
): ShortAnswerStudentPayload {
  const payloadData = (data || {}) as ShortAnswerPayloadInput;

  return {
    view: payloadData.view || "student",
    handler_urls: payloadData.handler_urls || {
      get_response: runtime.handlerUrl(element, "get_response"),
      reset: runtime.handlerUrl(element, "reset"),
    },
    initial_state: payloadData.initial_state || {
      messages: payloadData.messages as ShortAnswerMessage[] | undefined,
    },
    meta: payloadData.meta || {
      allow_reset: payloadData.allow_reset,
      character_image: payloadData.character_image,
      question: payloadData.question,
      max_responses: payloadData.max_responses,
    },
  };
}

const initializer = makeXBlockInitializer(
  ShortAnswerStudentApp,
  (runtime, element, data) => {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

const globalWindow = window as Window & {
  ShortAnswerAIEvalXBlock?: typeof initializer;
};

globalWindow.ShortAnswerAIEvalXBlock = initializer;
