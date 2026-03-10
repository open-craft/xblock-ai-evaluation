import React from "react";

import { makeXBlockInitializer } from "../shared/mountApp";
import { ensureMarkdownRenderer, renderMarkdown } from "../shared/renderMarkdown";

function normalizePayload(runtime, element, data) {
  return {
    handler_urls: data.handler_urls || {
      primary_action: runtime.handlerUrl(element, "get_character_response"),
      secondary_action: runtime.handlerUrl(element, "get_evaluator_response"),
      reset: runtime.handlerUrl(element, "reset_all"),
    },
    initial_state: data.initial_state || {
      chat_histories: data.chat_histories,
      attempts: data.attempts,
      finished: Boolean(data.finished),
      final_report: data.final_report,
    },
    meta: data.meta || {
      intro_text: data.intro_text,
      characters: data.characters,
      titles: data.titles,
      marked_html: data.marked_html,
    },
  };
}

function CoachingShell(props) {
  var payload = props.payload;
  var meta = payload.meta;
  var initialState = payload.initial_state;
  var state = React.useState(renderMarkdown(meta.intro_text));
  var introHtml = state[0];
  var setIntroHtml = state[1];

  React.useEffect(function loadMarkdown() {
    var isActive = true;

    ensureMarkdownRenderer(meta.marked_html).then(function renderIntro() {
      if (isActive) {
        setIntroHtml(renderMarkdown(meta.intro_text));
      }
    });

    return function cleanup() {
      isActive = false;
    };
  }, [meta.intro_text, meta.marked_html]);

  return React.createElement(
    "section",
    {
      className: "ai-eval-react-shell ai-eval-react-shell--coaching",
      "data-block-kind": "coaching",
    },
    [
      React.createElement("div", {
        key: "intro",
        dangerouslySetInnerHTML: { __html: introHtml },
      }),
      React.createElement(
        "div",
        {
          key: "meta",
          className: "ai-eval-react-shell__meta",
        },
        [
          React.createElement(
            "span",
            { key: "characters" },
            "Characters: " + String((meta.characters || []).length),
          ),
          React.createElement(
            "span",
            { key: "finished" },
            initialState.finished ? "Evaluation complete" : "Conversation active",
          ),
          React.createElement(
            "span",
            { key: "report" },
            initialState.final_report ? "Report loaded" : "No report yet",
          ),
        ],
      ),
    ],
  );
}

var initializer = makeXBlockInitializer(
  CoachingShell,
  function getProps(runtime, element, data) {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

window.AIEvalReactXBlocks = window.AIEvalReactXBlocks || {};
window.AIEvalReactXBlocks.coaching = initializer;
window.CoachAIEvalXBlock = initializer;
window.ReactCoachAIEvalXBlock = initializer;
