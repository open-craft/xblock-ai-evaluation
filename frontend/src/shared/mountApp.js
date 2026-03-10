import React from "react";
import ReactDOM from "react-dom";

function resolveMountNode(element, selector) {
  var mountNode;

  if (selector) {
    mountNode = element.querySelector(selector);
    if (mountNode) {
      return mountNode;
    }
  }

  mountNode = element.querySelector("[data-ai-eval-react-root]");
  if (mountNode) {
    return mountNode;
  }

  mountNode = document.createElement("div");
  mountNode.setAttribute("data-ai-eval-react-root", "true");
  element.appendChild(mountNode);
  return mountNode;
}

export function mountReactTree(element, reactElement, selector) {
  var mountNode = resolveMountNode(element, selector);
  ReactDOM.render(reactElement, mountNode);
  return mountNode;
}

export function makeXBlockInitializer(Component, getProps, selector) {
  return function initializeXBlock(runtime, element, data) {
    var props = getProps ? getProps(runtime, element, data || {}) : {};
    return mountReactTree(
      element,
      React.createElement(Component, props),
      selector,
    );
  };
}
