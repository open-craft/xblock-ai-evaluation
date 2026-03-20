import React, { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";

import { makeXBlockInitializer } from "../shared/mountApp";
import { ensureMarkdownRenderer, renderMarkdown } from "../shared/renderMarkdown";
import { SharedPayload, UnknownRecord, XBlockRuntime } from "../shared/types";

interface CoachingHandlerUrls extends UnknownRecord {
  get_character_response?: string;
  get_evaluator_response?: string;
  reset_all?: string;
}

interface CoachingInitialState extends UnknownRecord {
  attempts?: unknown;
  chat_histories?: unknown;
  final_report?: unknown;
  finished?: boolean;
}

interface CoachingMeta extends UnknownRecord {
  characters?: unknown[];
  intro_text?: string;
  marked_html?: string;
  titles?: unknown;
}

type CoachingPayload = SharedPayload<
  CoachingHandlerUrls,
  CoachingInitialState,
  CoachingMeta
>;

type CoachingPayloadInput = Partial<CoachingPayload> & {
  attempts?: unknown;
  chat_histories?: unknown;
  characters?: unknown[];
  final_report?: unknown;
  finished?: boolean;
  intro_text?: string;
  marked_html?: string;
  titles?: unknown;
};

function normalizePayload(
  runtime: XBlockRuntime,
  element: Element,
  data: unknown,
): CoachingPayload {
  const payloadData = (data || {}) as CoachingPayloadInput;

  return {
    view: payloadData.view || "student",
    handler_urls: payloadData.handler_urls || {
      get_character_response: runtime.handlerUrl(element, "get_character_response"),
      get_evaluator_response: runtime.handlerUrl(element, "get_evaluator_response"),
      reset_all: runtime.handlerUrl(element, "reset_all"),
    },
    initial_state: payloadData.initial_state || {
      chat_histories: payloadData.chat_histories,
      attempts: payloadData.attempts,
      finished: Boolean(payloadData.finished),
      final_report: payloadData.final_report,
    },
    meta: payloadData.meta || {
      intro_text: payloadData.intro_text,
      characters: payloadData.characters,
      titles: payloadData.titles,
      marked_html: payloadData.marked_html,
    },
  };
}

function CoachingStudentShell({ payload }: { payload: CoachingPayload }) {
  const { meta, initial_state: initialState } = payload;
  const [introHtml, setIntroHtml] = useState(renderMarkdown(meta.intro_text));
  const characterCount = Array.isArray(meta.characters) ? meta.characters.length : 0;

  useEffect(() => {
    let isActive = true;

    ensureMarkdownRenderer(meta.marked_html).then(() => {
      if (isActive) {
        setIntroHtml(renderMarkdown(meta.intro_text));
      }
    });

    return () => {
      isActive = false;
    };
  }, [meta.intro_text, meta.marked_html]);

  return (
    <section
      className="ai-eval-react-shell ai-eval-react-shell--coaching"
      data-block-kind="coaching"
      data-view={payload.view}
    >
      <div dangerouslySetInnerHTML={{ __html: introHtml }} />
      <div className="ai-eval-react-shell__meta">
        <span>
          <FormattedMessage
            id="coaching.student.characters"
            defaultMessage="Characters: {count}"
            values={{ count: characterCount }}
          />
        </span>
        <span>
          {initialState.finished ? (
            <FormattedMessage
              id="coaching.student.evaluationComplete"
              defaultMessage="Evaluation complete"
            />
          ) : (
            <FormattedMessage
              id="coaching.student.conversationActive"
              defaultMessage="Conversation active"
            />
          )}
        </span>
        <span>
          {initialState.final_report ? (
            <FormattedMessage id="coaching.student.reportLoaded" defaultMessage="Report loaded" />
          ) : (
            <FormattedMessage id="coaching.student.noReport" defaultMessage="No report yet" />
          )}
        </span>
      </div>
    </section>
  );
}

const initializer = makeXBlockInitializer(
  CoachingStudentShell,
  (runtime, element, data) => {
    return { payload: normalizePayload(runtime, element, data) };
  },
);

const globalWindow = window as Window & {
  CoachAIEvalXBlock?: typeof initializer;
};

globalWindow.CoachAIEvalXBlock = initializer;
