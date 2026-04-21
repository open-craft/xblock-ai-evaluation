import { makeXBlockInitializer } from "../shared/mountApp";
import CodingStudioApp from "./CodingStudioApp";
import { CodingStudioPayload } from "./types";

const initializer = makeXBlockInitializer(
  CodingStudioApp,
  (runtime, _element, data) => {
    return {
      payload: data as CodingStudioPayload,
      runtime,
    };
  },
);

const globalWindow = window as Window & {
  CodingAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.CodingAIEvalXBlockStudio = initializer;
