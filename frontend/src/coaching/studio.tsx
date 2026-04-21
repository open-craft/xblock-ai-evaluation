import { makeXBlockInitializer } from "../shared/mountApp";
import CoachingStudioApp from "./CoachingStudioApp";
import { CoachingStudioPayload } from "./types";

const initializer = makeXBlockInitializer(
  CoachingStudioApp,
  (runtime, _element, data) => {
    return {
      payload: data as CoachingStudioPayload,
      runtime,
    };
  },
);

const globalWindow = window as Window & {
  CoachAIEvalXBlockStudio?: typeof initializer;
};

globalWindow.CoachAIEvalXBlockStudio = initializer;
