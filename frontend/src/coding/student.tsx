import React, { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";

import { makeXBlockInitializer } from "../shared/mountApp";
import { ensureMarkdownRenderer, renderMarkdown } from "../shared/renderMarkdown";
import { SharedPayload, UnknownRecord, XBlockElementLike, XBlockRuntime } from "../shared/types";

interface CodingHandlerUrls extends UnknownRecord {
  get_response?: string;
  get_submission_result_handler?: string;
  reset_handler?: string;
  submit_code_handler?: string;
}

interface CodingInitialState extends UnknownRecord {
  ai_evaluation?: unknown;
  code?: string;
  code_exec_result?: unknown;
}

interface CodingMeta extends UnknownRecord {
  language?: string;
  marked_html?: string;
  monaco_html?: string;
  question?: string;
}

type CodingPayload = SharedPayload<CodingHandlerUrls, CodingInitialState, CodingMeta>;

type CodingPayloadInput = Partial<CodingPayload> & {
  ai_evaluation?: unknown;
  code?: string;
  code_exec_result?: unknown;
  language?: string;
  marked_html?: string;
  monaco_html?: string;
  question?: string;
};

function normalizePayload(
  runtime: XBlockRuntime,
  element: XBlockElementLike,
  data: unknown,
): CodingPayload {
  const payloadData = (data || {}) as CodingPayloadInput;

  return {
    view: payloadData.view || "student",
    handler_urls: payloadData.handler_urls || {
      submit_code_handler: runtime.handlerUrl(element, "submit_code_handler"),
      get_submission_result_handler: runtime.handlerUrl(
        element,
        "get_submission_result_handler",
      ),
      get_response: runtime.handlerUrl(element, "get_response"),
      reset_handler: runtime.handlerUrl(element, "reset_handler"),
    },
    initial_state: payloadData.initial_state || {
      code: payloadData.code,
      ai_evaluation: payloadData.ai_evaluation,
      code_exec_result: payloadData.code_exec_result,
    },
    meta: payloadData.meta || {
      question: payloadData.question,
      language: payloadData.language,
      monaco_html: payloadData.monaco_html,
      marked_html: payloadData.marked_html,
    },
  };
}

function CodingStudentShell({ payload }: { payload: CodingPayload }) {
  const { meta, initial_state: initialState } = payload;
  const [questionHtml, setQuestionHtml] = useState(renderMarkdown(meta.question));

  useEffect(() => {
    let isActive = true;

    ensureMarkdownRenderer(meta.marked_html).then(() => {
      if (isActive) {
        setQuestionHtml(renderMarkdown(meta.question));
      }
    });

    return () => {
      isActive = false;
    };
  }, [meta.marked_html, meta.question]);

  return (
    <section
      className="ai-eval-react-shell ai-eval-react-shell--coding"
      data-block-kind="coding"
      data-view={payload.view}
    >
      <div dangerouslySetInnerHTML={{ __html: questionHtml }} />
      <div className="ai-eval-react-shell__meta">
        <span>
          {meta.language || (
            <FormattedMessage
              id="coding.student.languageNotSet"
              defaultMessage="Language not set"
            />
          )}
        </span>
        <span>
          <FormattedMessage
            id="coding.student.codeChars"
            defaultMessage="Code chars: {count}"
            values={{ count: (initialState.code || "").length }}
          />
        </span>
        <span>
          {initialState.ai_evaluation ? (
            <FormattedMessage
              id="coding.student.feedbackLoaded"
              defaultMessage="Feedback loaded"
            />
          ) : (
            <FormattedMessage
              id="coding.student.noFeedback"
              defaultMessage="No feedback yet"
            />
          )}
        </span>
      </div>
    </section>
  );
}

const initializer = makeXBlockInitializer(
  CodingStudentShell,
  (runtime, element, data) => {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

const globalWindow = window as Window & {
  CodingAIEvalXBlock?: typeof initializer;
};

globalWindow.CodingAIEvalXBlock = initializer;
