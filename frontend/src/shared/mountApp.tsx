import React from "react";
import ReactDOM from "react-dom";

import { SharedIntlProvider } from "./i18n";
import { XBlockElementLike, XBlockPropsFactory, XBlockRuntime } from "./types";

function toDomElement(element: XBlockElementLike) {
  if (element instanceof Element) {
    return element;
  }

  if (element && element[0] instanceof Element) {
    return element[0];
  }

  throw new Error("XBlock initializer received an unsupported root element.");
}

function resolveMountNode(elementLike: XBlockElementLike, selector?: string) {
  const element = toDomElement(elementLike);
  let mountNode: Element | null = null;

  if (selector) {
    mountNode = element.querySelector(selector);
    if (mountNode instanceof HTMLElement) {
      return mountNode;
    }
  }

  mountNode = element.querySelector("[data-ai-eval-react-root]");
  if (mountNode instanceof HTMLElement) {
    return mountNode;
  }

  const nextMountNode = document.createElement("div");
  nextMountNode.setAttribute("data-ai-eval-react-root", "true");
  element.appendChild(nextMountNode);
  return nextMountNode;
}

export function mountReactTree(
  element: XBlockElementLike,
  reactElement: React.ReactElement,
  selector?: string,
) {
  const mountNode = resolveMountNode(element, selector);
  mountNode.classList.add("ai-eval-paragon");

  ReactDOM.render(
    <SharedIntlProvider>{reactElement}</SharedIntlProvider>,
    mountNode,
  );

  return mountNode;
}

export function makeXBlockInitializer<Props extends Record<string, unknown>>(
  Component: React.ComponentType<Props>,
  getProps?: XBlockPropsFactory<Props>,
  selector?: string,
) {
  return function initializeXBlock(
    runtime: XBlockRuntime,
    element: XBlockElementLike,
    data?: unknown,
  ) {
    const props = getProps ? getProps(runtime, element, data || {}) : ({} as Props);
    return mountReactTree(element, React.createElement(Component, props), selector);
  };
}
