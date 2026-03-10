import React from "react";

import { makeXBlockInitializer } from "../shared/mountApp";
import { ensureMarkdownRenderer, renderMarkdown } from "../shared/renderMarkdown";

function normalizePayload(runtime, element, data) {
  return {
    handler_urls: data.handler_urls || {
      primary_action: runtime.handlerUrl(element, "get_response"),
    },
    initial_state: data.initial_state || {
      messages: data.messages,
      max_responses: data.max_responses,
    },
    meta: data.meta || {
      question: data.question,
      marked_html: data.marked_html,
    },
  };
}

function ShortAnswerShell(props) {
  var payload = props.payload;
  var meta = payload.meta;
  var initialState = payload.initial_state;
  var state = React.useState(renderMarkdown(meta.question));
  var questionHtml = state[0];
  var setQuestionHtml = state[1];

  React.useEffect(function loadMarkdown() {
    var isActive = true;

    ensureMarkdownRenderer(meta.marked_html).then(function renderQuestion() {
      if (isActive) {
        setQuestionHtml(renderMarkdown(meta.question));
      }
    });

    return function cleanup() {
      isActive = false;
    };
  }, [meta.marked_html, meta.question]);

  return React.createElement(
    "section",
    {
      className: "ai-eval-react-shell ai-eval-react-shell--shortanswer",
      "data-block-kind": "shortanswer",
    },
    [
      React.createElement("div", {
        key: "question",
        dangerouslySetInnerHTML: { __html: questionHtml },
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
            { key: "messages" },
            String((initialState.messages || []).length) + " messages loaded",
          ),
          React.createElement(
            "span",
            { key: "limit" },
            "Max responses: " + String(initialState.max_responses || 0),
          ),
        ],
      ),
    ],
  );
}

var initializer = makeXBlockInitializer(
  ShortAnswerShell,
  function getProps(runtime, element, data) {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

window.AIEvalReactXBlocks = window.AIEvalReactXBlocks || {};
window.AIEvalReactXBlocks.shortanswer = initializer;
window.ShortAnswerAIEvalXBlock = initializer;
window.ReactShortAnswerAIEvalXBlock = initializer;
