import { makeXBlockInitializer } from "../shared/mountApp";
import CoachingStudioApp from "./CoachingStudioApp";
import { CoachingStudioPayload } from "./types";

const initializer = makeXBlockInitializer(
  CoachingStudioApp,
  (runtime, element, data) => {
    return {
      payload: data as CoachingStudioPayload,
      runtime,
      element,
    };
  },
);

const globalWindow = window as Window & {
  CoachAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.CoachAIEvalXBlockStudio = initializer;
