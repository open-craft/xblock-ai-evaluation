import { makeXBlockInitializer } from "../shared/mountApp";
import CoachingStudentApp from "./CoachingStudentApp";
import { CoachingStudentPayload } from "./types";

const initializer = makeXBlockInitializer(
  CoachingStudentApp,
  (_runtime, _element, data) => {
    return { payload: data as CoachingStudentPayload };
  },
);

const globalWindow = window as Window & {
  CoachAIEvalXBlock?: typeof initializer;
};

globalWindow.CoachAIEvalXBlock = initializer;
