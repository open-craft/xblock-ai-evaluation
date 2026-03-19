import React from "react";
import ReactDOM from "react-dom";

import { SharedIntlProvider } from "./i18n";
import { XBlockPropsFactory, XBlockRuntime } from "./types";

function resolveMountNode(element: Element, selector?: string) {
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
  element: Element,
  reactElement: React.ReactElement,
  selector?: string,
) {
  const mountNode = resolveMountNode(element, selector);

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
    element: Element,
    data?: unknown,
  ) {
    const props = getProps ? getProps(runtime, element, data || {}) : ({} as Props);
    return mountReactTree(element, React.createElement(Component, props), selector);
  };
}
