import { makeXBlockInitializer } from "../shared/mountApp";
import { XBlockElementLike, XBlockRuntime } from "../shared/types";
import ShortAnswerStudioApp from "./ShortAnswerStudioApp";
import { ShortAnswerStudioPayload } from "./types";

type StudioPayloadInput = Partial<ShortAnswerStudioPayload>;

function normalizePayload(
  runtime: XBlockRuntime,
  element: XBlockElementLike,
  data: unknown,
): ShortAnswerStudioPayload {
  const payloadData = (data || {}) as StudioPayloadInput;

  return {
    view: "studio",
    handler_urls: payloadData.handler_urls || {
      studio_submit: runtime.handlerUrl(element, "studio_submit"),
    },
    initial_state: payloadData.initial_state || {},
    meta: payloadData.meta || {},
  };
}

const initializer = makeXBlockInitializer(
  ShortAnswerStudioApp,
  (runtime, element, data) => {
    return {
      payload: normalizePayload(runtime, element, data),
      runtime,
    };
  },
);

const globalWindow = window as Window & {
  ShortAnswerAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.ShortAnswerAIEvalXBlockStudio = initializer;
