import React from "react";
import ReactDOM from "react-dom";

import { SharedIntlProvider } from "./i18n";
import { SharedPayload, XBlockElementLike, XBlockPropsFactory, XBlockRuntime } from "./types";


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

const DEFAULT_CORE_CSS_URL = "https://cdn.jsdelivr.net/npm/@openedx/paragon@23/dist/core.min.css";
const DEFAULT_THEME_CSS_URL = "https://cdn.jsdelivr.net/npm/@openedx/paragon@23/dist/light.min.css";

// The MFE config endpoint only exists on the LMS. In Studio the page is served
// from the CMS origin, so this cross-origin fetch is typically blocked by CORS.
// Keep the timeout short and treat any failure as "use the default theme".
const THEME_FETCH_TIMEOUT_MS = 3000;

const getBrandOverrideUrls = async (mfe_config_api_url: string): Promise<string[]> => {
  let themeUrls: ThemeUrls | Record<string, never> = {};
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), THEME_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(mfe_config_api_url, { signal: controller.signal });
    const mfeConfig = await response.json();
    themeUrls = mfeConfig.PARAGON_THEME_URLS;
  } catch (error) {
    console.warn("Failed to fetch theme URLs; using the default Paragon theme:", error);
    return [];
  } finally {
    window.clearTimeout(timeoutId);
  }
  const variant = themeUrls?.["default"]?.["light"];
  return [
    themeUrls?.["core"]?.["urls"]?.["brandOverride"],
    themeUrls?.["variants"]?.[variant]?.["urls"]?.["brandOverride"],
  ].filter(Boolean);
};

function toDomElement(element: XBlockElementLike) {
  if (element instanceof Element) {
    return element;
  }

  if (element && element[0] instanceof Element) {
    return element[0];
  }

  throw new Error("XBlock initializer received an unsupported root element.");
}

const ENABLE_SHADOW_ROOT = true;
// Re: The Shadow DOM
// The Shadow DOM allows us to isolate the XBlock from the rest of the page. Any
// Stylesheets we attach inside it will not affect outside content, and any outside
// styling will leak inside it. However, for this to work all the styling need to be
// inside the Shadow DOM.
// There are currently a few issues with this:
// - Paragon CSS doesn't use the :host selector for variables.
// - Variables scoped to :root will only work inside the Shadow DOM if included
//   in a stylesheet outside the Shadow DOM. If loaded inside the Shadow DOM,
//   they will not be available.
// - Variables scoped to :host will work inside the Shadow DOM if the stylesheet
//   is loaded inside the Shadow DOM. PR here: https://github.com/openedx/paragon/pull/4282
// So we temporarily need to load the Paragon CSS both inside and outside the Shadow DOM.
const attachStylesheet = (url: string, shadowRoot: ShadowRoot | null) => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  shadowRoot?.appendChild(link);
  if (!document.head.querySelector(`link[href="${url}"]`)) {
    document.head.appendChild(link.cloneNode());
  }
};

const buildRootNode = (element: Element, styleUrls: string[], mfe_config_api: string) => {
  const rootElement = element.querySelector("[data-ai-eval-react-root]");
  if (rootElement == null) {
    throw new Error("No [data-ai-eval-react-root] element found");
  }

  let shadowRoot: ShadowRoot | null = null;
  let root = rootElement;
  if (ENABLE_SHADOW_ROOT) {
    shadowRoot = rootElement.attachShadow({ mode: 'open' });
    root = document.createElement('div');
    shadowRoot.appendChild(root);
  }
  styleUrls.forEach((styleContent) => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = styleContent;
    if (shadowRoot) {
      shadowRoot.appendChild(style);
    } else {
      document.head.appendChild(style);
    }
  });

  // Attach the default Paragon CSS immediately so the app can mount without
  // waiting on the network. Brand overrides are applied when/if the MFE
  // config fetch resolves; on failure the defaults simply remain in place.
  attachStylesheet(DEFAULT_CORE_CSS_URL, shadowRoot);
  attachStylesheet(DEFAULT_THEME_CSS_URL, shadowRoot);
  getBrandOverrideUrls(mfe_config_api).then((brandOverrideUrls) => {
    brandOverrideUrls.forEach((url) => attachStylesheet(url, shadowRoot));
  }).catch(() => {
    // Defensive: getBrandOverrideUrls handles its own errors, but a rejection
    // here must never surface as an unhandled promise rejection.
  });

  return root;
}

export function makeXBlockInitializer<Props extends Record<string, unknown>>(
  Component: React.ComponentType<Props>,
  getProps: XBlockPropsFactory<Props>,
) {
  return function initializeXBlock(
    runtime: XBlockRuntime,
    elementLike: XBlockElementLike,
    data: SharedPayload,
  ) {
    const props = getProps(runtime, elementLike, data || {});

    const element = toDomElement(elementLike);
    const rootNode = buildRootNode(element, data.style_urls, data.mfe_config_api);

    ReactDOM.render(
      <SharedIntlProvider><Component {...props} /></SharedIntlProvider>,
      rootNode,
    );

    return rootNode;
  };
}
