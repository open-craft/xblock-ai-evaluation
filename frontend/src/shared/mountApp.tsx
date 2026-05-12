import React from "react";
import { createRoot } from "react-dom/client";

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

interface ThemeUrls {
  core: {
    urls: {
      default: string;
      brandOverride: string;
    };
  };
  default: {
    light: string;
    [key: string]: string;
  };
  variants: {
    [key: string]: {
      urls: {
        brandOverride: string;
      };
    };
  };
}

async function getThemes() {
  let themeUrls: ThemeUrls | Record<string, never> = {};
  try {
    const response = await fetch("/api/mfe_config/v1");
    const mfeConfig = await response.json();
    themeUrls = mfeConfig.PARAGON_THEME_URLS;
  } catch (error) {
    console.error("Failed to fetch theme URLs:", error);
  }
  const variant = themeUrls?.["default"]?.["light"];
  const theme: string[] = [
    "https://cdn.jsdelivr.net/npm/@openedx/paragon@23/dist/light.min.css",
    themeUrls?.["variants"]?.[variant]?.["urls"]?.["brandOverride"],
  ].filter(Boolean);
  const core: string[] = [
    "https://cdn.jsdelivr.net/npm/@openedx/paragon@23/dist/core.min.css",
    themeUrls?.["core"]?.["urls"]?.["brandOverride"],
  ].filter(Boolean);

  return { core, theme };
}

export async function mountReactTree(
  element: XBlockElementLike,
  reactElement: React.ReactElement,
  selector?: string,
) {
  const { core, theme } = await getThemes();

  core.forEach((url) => {
    if (!document.head.querySelector(`link[href="${url}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      document.head.appendChild(link);
    }
  });

  theme.forEach((url) => {
    if (!document.head.querySelector(`link[href="${url}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      document.head.appendChild(link);
    }
  });

  const mountNode = resolveMountNode(element, selector);

  const root = createRoot(mountNode);
  root.render(<SharedIntlProvider>{reactElement}</SharedIntlProvider>);

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
