import { makeXBlockInitializer } from "../shared/mountApp";
import ShortAnswerStudentApp from "./ShortAnswerStudentApp";
import { ShortAnswerStudentPayload } from "./types";

const initializer = makeXBlockInitializer(
  ShortAnswerStudentApp,
  (_runtime, _element, data) => {
    return { payload: data as ShortAnswerStudentPayload };
  },
);

const globalWindow = window as Window & {
  ShortAnswerAIEvalXBlock?: typeof initializer;
};

globalWindow.ShortAnswerAIEvalXBlock = initializer;
