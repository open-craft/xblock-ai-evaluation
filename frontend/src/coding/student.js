import React from "react";

import { makeXBlockInitializer } from "../shared/mountApp";
import { ensureMarkdownRenderer, renderMarkdown } from "../shared/renderMarkdown";

function normalizePayload(runtime, element, data) {
  return {
    view: data.view || "student",
    handler_urls: data.handler_urls || {
      submit_code_handler: runtime.handlerUrl(element, "submit_code_handler"),
      get_submission_result_handler: runtime.handlerUrl(
        element,
        "get_submission_result_handler",
      ),
      get_response: runtime.handlerUrl(element, "get_response"),
      reset_handler: runtime.handlerUrl(element, "reset_handler"),
    },
    initial_state: data.initial_state || {
      code: data.code,
      ai_evaluation: data.ai_evaluation,
      code_exec_result: data.code_exec_result,
    },
    meta: data.meta || {
      question: data.question,
      language: data.language,
      monaco_html: data.monaco_html,
      marked_html: data.marked_html,
    },
  };
}

function CodingStudentShell(props) {
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
      className: "ai-eval-react-shell ai-eval-react-shell--coding",
      "data-block-kind": "coding",
      "data-view": payload.view,
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
            { key: "language" },
            meta.language || "Language not set",
          ),
          React.createElement(
            "span",
            { key: "code" },
            "Code chars: " + String((initialState.code || "").length),
          ),
          React.createElement(
            "span",
            { key: "feedback" },
            initialState.ai_evaluation ? "Feedback loaded" : "No feedback yet",
          ),
        ],
      ),
    ],
  );
}

var initializer = makeXBlockInitializer(
  CodingStudentShell,
  function getProps(runtime, element, data) {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

window.AIEvalReactXBlocks = window.AIEvalReactXBlocks || {};
window.AIEvalReactXBlocks.coding = initializer;
window.CodingAIEvalXBlock = initializer;
window.ReactCodingAIEvalXBlock = initializer;
