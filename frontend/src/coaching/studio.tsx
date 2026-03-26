import { makeXBlockInitializer } from "../shared/mountApp";
import { XBlockElementLike, XBlockRuntime } from "../shared/types";
import CoachingStudioApp from "./CoachingStudioApp";
import { CoachingStudioPayload } from "./types";

type StudioPayload = CoachingStudioPayload;
type StudioPayloadInput = Partial<CoachingStudioPayload>;

function normalizePayload(
  runtime: XBlockRuntime,
  element: XBlockElementLike,
  data: unknown,
): StudioPayload {
  const payloadData = (data || {}) as StudioPayloadInput;

  return {
    view: payloadData.view || "studio",
    handler_urls: payloadData.handler_urls || {
      studio_submit: runtime.handlerUrl(element, "studio_submit"),
    },
    initial_state: payloadData.initial_state || {},
    meta: payloadData.meta || {},
  };
}

const initializer = makeXBlockInitializer(
  CoachingStudioApp,
  (runtime, element, data) => {
    return {
      payload: normalizePayload(runtime, element, data),
      runtime,
    };
  },
);

const globalWindow = window as Window & {
  CoachAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.CoachAIEvalXBlockStudio = initializer;
