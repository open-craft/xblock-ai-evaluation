import { makeXBlockInitializer } from "../shared/mountApp";
import { XBlockElementLike } from "../shared/types";
import CodingStudentApp from "./CodingStudentApp";
import { CodingStudentPayload } from "./types";

function resolveUsageId(element: XBlockElementLike) {
  if (element instanceof Element) {
    return element.getAttribute("data-usage") || element.getAttribute("data-usage-id") || "";
  }

  const rootElement = element?.[0];
  if (rootElement instanceof Element) {
    return (
      rootElement.getAttribute("data-usage") || rootElement.getAttribute("data-usage-id") || ""
    );
  }

  return "";
}

const initializer = makeXBlockInitializer(
  CodingStudentApp,
  (_runtime, element, data) => {
    const usageId = resolveUsageId(element);

    if (!usageId) {
      throw new Error("XBlock is missing a usage ID attribute on its root HTML node.");
    }

    return {
      payload: data as CodingStudentPayload,
      usageId,
    };
  },
);

const globalWindow = window as Window & {
  CodingAIEvalXBlock?: typeof initializer;
};

globalWindow.CodingAIEvalXBlock = initializer;
