import { makeXBlockInitializer } from "../shared/mountApp";
import ShortAnswerStudioApp from "./ShortAnswerStudioApp";
import { ShortAnswerStudioPayload } from "./types";

const initializer = makeXBlockInitializer(
  ShortAnswerStudioApp,
  (runtime, _element, data) => {
    return {
      payload: data as ShortAnswerStudioPayload,
      runtime,
    };
  },
);

const globalWindow = window as Window & {
  ShortAnswerAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.ShortAnswerAIEvalXBlockStudio = initializer;
