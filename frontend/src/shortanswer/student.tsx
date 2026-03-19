import React from "react";
import { FormattedMessage } from "react-intl";

import { makeXBlockInitializer } from "../shared/mountApp";
import { ensureMarkdownRenderer, renderMarkdown } from "../shared/renderMarkdown";
import { SharedPayload, UnknownRecord, XBlockRuntime } from "../shared/types";

interface ShortAnswerHandlerUrls extends UnknownRecord {
  get_response?: string;
  reset?: string;
}

interface ShortAnswerInitialState extends UnknownRecord {
  max_responses?: number;
  messages?: unknown[];
}

interface ShortAnswerMeta extends UnknownRecord {
  marked_html?: string;
  question?: string;
}

type ShortAnswerPayload = SharedPayload<
  ShortAnswerHandlerUrls,
  ShortAnswerInitialState,
  ShortAnswerMeta
>;

type ShortAnswerLegacyData = Partial<ShortAnswerPayload> & {
  marked_html?: string;
  max_responses?: number;
  messages?: unknown[];
  question?: string;
};

function normalizePayload(
  runtime: XBlockRuntime,
  element: Element,
  data: unknown,
): ShortAnswerPayload {
  const payloadData = (data || {}) as ShortAnswerLegacyData;

  return {
    view: payloadData.view || "student",
    handler_urls: payloadData.handler_urls || {
      get_response: runtime.handlerUrl(element, "get_response"),
      reset: runtime.handlerUrl(element, "reset"),
    },
    initial_state: payloadData.initial_state || {
      messages: payloadData.messages,
      max_responses: payloadData.max_responses,
    },
    meta: payloadData.meta || {
      question: payloadData.question,
      marked_html: payloadData.marked_html,
    },
  };
}

function ShortAnswerStudentShell({ payload }: { payload: ShortAnswerPayload }) {
  const { meta, initial_state: initialState } = payload;
  const [questionHtml, setQuestionHtml] = React.useState(renderMarkdown(meta.question));
  const messageCount = Array.isArray(initialState.messages) ? initialState.messages.length : 0;

  React.useEffect(() => {
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
      className="ai-eval-react-shell ai-eval-react-shell--shortanswer"
      data-block-kind="shortanswer"
      data-view={payload.view}
    >
      <div dangerouslySetInnerHTML={{ __html: questionHtml }} />
      <div className="ai-eval-react-shell__meta">
        <span>
          <FormattedMessage
            id="shortanswer.student.messagesLoaded"
            defaultMessage="{count} messages loaded"
            values={{ count: messageCount }}
          />
        </span>
        <span>
          <FormattedMessage
            id="shortanswer.student.maxResponses"
            defaultMessage="Max responses: {count}"
            values={{ count: initialState.max_responses || 0 }}
          />
        </span>
      </div>
    </section>
  );
}

const initializer = makeXBlockInitializer(
  ShortAnswerStudentShell,
  (runtime, element, data) => {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

const globalWindow = window as Window & {
  AIEvalReactXBlocks?: Record<string, typeof initializer>;
  ReactShortAnswerAIEvalXBlock?: typeof initializer;
  ShortAnswerAIEvalXBlock?: typeof initializer;
};

globalWindow.AIEvalReactXBlocks = globalWindow.AIEvalReactXBlocks || {};
globalWindow.AIEvalReactXBlocks.shortanswer = initializer;
globalWindow.ShortAnswerAIEvalXBlock = initializer;
globalWindow.ReactShortAnswerAIEvalXBlock = initializer;
