import React from "react";

import { makeXBlockInitializer } from "../shared/mountApp";
import StudioPlaceholder from "../shared/StudioPlaceholder";

function normalizePayload(runtime, element, data) {
  return {
    view: data.view || "studio",
    handler_urls: data.handler_urls || {
      studio_submit: runtime.handlerUrl(element, "studio_submit"),
    },
    initial_state: data.initial_state || {},
    meta: data.meta || {},
  };
}

var initializer = makeXBlockInitializer(
  function CoachingStudioPlaceholder(props) {
    return React.createElement(StudioPlaceholder, {
      title: "Coaching Studio Shell",
      blockKind: "coaching",
      payload: props.payload,
    });
  },
  function getProps(runtime, element, data) {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

window.AIEvalReactXBlocks = window.AIEvalReactXBlocks || {};
window.AIEvalReactXBlocks.coachingStudio = initializer;
window.CoachAIEvalXBlockStudio = initializer;
