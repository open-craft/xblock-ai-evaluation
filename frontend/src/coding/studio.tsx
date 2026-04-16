import { makeXBlockInitializer } from "../shared/mountApp";
import { XBlockElementLike, XBlockRuntime } from "../shared/types";
import CodingStudioApp from "./CodingStudioApp";
import { CodingStudioPayload } from "./types";

type StudioPayloadInput = Partial<CodingStudioPayload>;

function normalizePayload(
  runtime: XBlockRuntime,
  element: XBlockElementLike,
  data: unknown,
): CodingStudioPayload {
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
  CodingStudioApp,
  (runtime, element, data) => {
    return {
      payload: normalizePayload(runtime, element, data),
      runtime,
    };
  },
);

const globalWindow = window as Window & {
  CodingAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.CodingAIEvalXBlockStudio = initializer;
