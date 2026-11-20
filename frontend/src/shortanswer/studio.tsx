import { makeXBlockInitializer } from "../shared/mountApp";
import ShortAnswerStudioApp from "./ShortAnswerStudioApp";
import { ShortAnswerStudioPayload } from "./types";

const initializer = makeXBlockInitializer(
  ShortAnswerStudioApp,
  (runtime, element, data) => {
    return {
      payload: data as ShortAnswerStudioPayload,
      runtime,
      element,
    };
  },
);

const globalWindow = window as Window & {
  ShortAnswerAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.ShortAnswerAIEvalXBlockStudio = initializer;
