import { makeXBlockInitializer } from "../shared/mountApp";
import { XBlockElementLike, XBlockRuntime } from "../shared/types";
import CoachingStudentApp from "./CoachingStudentApp";
import { CoachingStudentPayload } from "./types";

type CoachingPayloadInput = Partial<CoachingStudentPayload> & {
  allow_reset?: boolean;
  attempts?: unknown;
  chat_histories?: unknown;
  characters?: unknown[];
  coach_initial_message?: unknown;
  final_report?: unknown;
  finished?: boolean;
  initial_message?: unknown;
  intro_text?: string;
  titles?: unknown;
};

function normalizePayload(
  runtime: XBlockRuntime,
  element: XBlockElementLike,
  data: unknown,
): CoachingStudentPayload {
  const payloadData = (data || {}) as CoachingPayloadInput;
  const fallbackInitialState: CoachingStudentPayload["initial_state"] = {
    chat_histories: payloadData.chat_histories as CoachingStudentPayload["initial_state"]["chat_histories"],
    attempts: payloadData.attempts as CoachingStudentPayload["initial_state"]["attempts"],
    finished: Boolean(payloadData.finished),
    final_report: payloadData.final_report as CoachingStudentPayload["initial_state"]["final_report"],
  };
  const fallbackMeta: CoachingStudentPayload["meta"] = {
    allow_reset: typeof payloadData.allow_reset === "boolean" ? payloadData.allow_reset : undefined,
    intro_text: payloadData.intro_text,
    characters: payloadData.characters as CoachingStudentPayload["meta"]["characters"],
    initial_message:
      payloadData.initial_message as CoachingStudentPayload["meta"]["initial_message"],
    coach_initial_message:
      payloadData.coach_initial_message as CoachingStudentPayload["meta"]["coach_initial_message"],
    titles: payloadData.titles as CoachingStudentPayload["meta"]["titles"],
  };

  return {
    view: payloadData.view || "student",
    handler_urls: payloadData.handler_urls || {
      get_character_response: runtime.handlerUrl(element, "get_character_response"),
      get_evaluator_response: runtime.handlerUrl(element, "get_evaluator_response"),
      reset_all: runtime.handlerUrl(element, "reset_all"),
    },
    initial_state: payloadData.initial_state || fallbackInitialState,
    meta: payloadData.meta || fallbackMeta,
  };
}

const initializer = makeXBlockInitializer(
  CoachingStudentApp,
  (runtime, element, data) => {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

const globalWindow = window as Window & {
  CoachAIEvalXBlock?: typeof initializer;
};

globalWindow.CoachAIEvalXBlock = initializer;
