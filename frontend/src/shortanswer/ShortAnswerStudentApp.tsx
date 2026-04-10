import React, { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";

import { postJson, RequestError } from "../shared/request";
import { renderMarkdown } from "../shared/renderMarkdown";
import { UnknownRecord } from "../shared/types";
import { ShortAnswerMessage, ShortAnswerStudentPayload } from "./types";

interface ShortAnswerResponse extends UnknownRecord {
  response?: string;
}

let nextStableId = 0;

function useStableId(prefix: string) {
  const idRef = useRef<string>();

  if (!idRef.current) {
    nextStableId += 1;
    idRef.current = prefix + "-" + String(nextStableId);
  }

  return idRef.current;
}

function normalizeMessages(messages: unknown): ShortAnswerMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const rawMessage = message as ShortAnswerMessage;
    return [{
      source: rawMessage.source || "",
      content: typeof rawMessage.content === "string" ? rawMessage.content : "",
    }];
  });
}

function countUserMessages(messages: ShortAnswerMessage[]) {
  return messages.reduce((count, message) => {
    return count + (message.source === "user" ? 1 : 0);
  }, 0);
}

function autoResizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = String(textarea.scrollHeight) + "px";
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof RequestError && error.message) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

function QuestionPanel({
  questionHtml,
  questionRef,
}: {
  questionHtml: string;
  questionRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="shortanswer-question">
      <div
        className="question-text"
        ref={questionRef}
        dangerouslySetInnerHTML={{ __html: questionHtml }}
      />
    </div>
  );
}

function MessageList({
  messages,
  minHeight,
  pending,
  historyRef,
}: {
  messages: ShortAnswerMessage[];
  minHeight: number | null;
  pending: boolean;
  historyRef: React.RefObject<HTMLDivElement>;
}) {
  const renderedMessages = useMemo(
    () => messages.map((msg) => renderMarkdown(msg.content)),
    [messages],
  );

  return (
    <div
      className="chat-history"
      ref={historyRef}
      style={{ minHeight: minHeight === null ? undefined : minHeight }}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
      aria-busy={pending ? "true" : undefined}
    >
      {messages.map((message, index) => {
        const messageClassName = message.source === "user" ? "user-answer" : "ai-eval";

        return (
          <div className="chat-message-container" key={String(index)}>
            <div className={"chat-message " + messageClassName}>
              <div dangerouslySetInnerHTML={{ __html: renderedMessages[index] }} />
            </div>
          </div>
        );
      })}
      <div className="chat-message-container chat-spinner-container">
        {pending ? (
          <div className="chat-message message-spinner" aria-hidden="true">
            <div className="bounce1" />
            <div className="bounce2" />
            <div className="bounce3" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusRegion({ message }: { message: string }) {
  return (
    <div className="sr-only chat-status" role="status" aria-live="polite">
      {message}
    </div>
  );
}

function MessageComposer({
  allowReset,
  canReset,
  canSubmit,
  disabled,
  draft,
  instructionsId,
  onChange,
  onKeyDown,
  onReset,
  onSubmit,
  textareaRef,
}: {
  allowReset: boolean;
  canReset: boolean;
  canSubmit: boolean;
  disabled: boolean;
  draft: string;
  instructionsId: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onReset: () => void;
  onSubmit: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const intl = useIntl();
  const submitLabel = intl.formatMessage({
    id: "shortanswer.student.submit",
    defaultMessage: "Submit",
  });

  return (
    <React.Fragment>
      <div className="chat-instructions" id={instructionsId}>
        <p>
          {intl.formatMessage({
            id: "shortanswer.student.instructions",
            defaultMessage:
              "Use the Submit button or press Ctrl+Enter (Cmd+Enter on Mac) to send your message. Use Shift+Enter to insert a new line.",
          })}
        </p>
      </div>
      <div className="chat-submit-row">
        {allowReset ? (
          <button
            type="button"
            className={
              "btn chat-button chat-reset-button" + (canReset ? "" : " disabled")
            }
            disabled={!canReset}
            aria-disabled={!canReset}
            onClick={onReset}
          >
            {intl.formatMessage({
              id: "shortanswer.student.reset",
              defaultMessage: "Reset chat",
            })}
          </button>
        ) : null}
        <textarea
          ref={textareaRef}
          className={"chat-user-input" + (disabled ? " disabled" : "")}
          rows={1}
          aria-describedby={instructionsId}
          disabled={disabled}
          aria-disabled={disabled}
          placeholder={intl.formatMessage({
            id: "shortanswer.student.placeholder",
            defaultMessage: "Type your answer here",
          })}
          maxLength={1000}
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={
            "btn btn-primary chat-button chat-submit-button" +
            (canSubmit ? "" : " disabled")
          }
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          onClick={onSubmit}
        >
          {submitLabel}
        </button>
      </div>
    </React.Fragment>
  );
}

export default function ShortAnswerStudentApp({
  payload,
}: {
  payload: ShortAnswerStudentPayload;
}) {
  const intl = useIntl();
  const initialMessages = useMemo(() => {
    return normalizeMessages(payload.initial_state.messages);
  }, [payload.initial_state.messages]);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const questionHtml = useMemo(() => renderMarkdown(payload.meta.question), [payload.meta.question]);
  const [chatMinHeight, setChatMinHeight] = useState<number | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const instructionsId = useStableId("shortanswer-chat-instructions");
  const userMessageCount = countUserMessages(messages);
  const maxResponses = Number(payload.meta.max_responses || 0);
  const allowReset = Boolean(payload.meta.allow_reset);
  const canSubmit = !pending && draft.length > 0 && userMessageCount < maxResponses;
  const canReset = allowReset && !pending && userMessageCount > 0;
  const controlsDisabled = pending || userMessageCount >= maxResponses;

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    autoResizeTextarea(textareaRef.current);
  }, [draft]);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages, pending]);

  useEffect(() => {
    function updateChatMinHeight() {
      const imageElement = imageRef.current;
      const questionElement = questionRef.current;

      if (!imageElement || !questionElement) {
        setChatMinHeight(null);
        return;
      }

      const imageHeight = imageElement.height;
      if (!imageHeight) {
        setChatMinHeight(null);
        return;
      }

      const questionHeight = questionElement.offsetHeight;
      const nextMinHeight = imageHeight - questionHeight;
      setChatMinHeight(nextMinHeight > 0 ? nextMinHeight : null);
    }

    updateChatMinHeight();
    window.addEventListener("resize", updateChatMinHeight);

    return () => {
      window.removeEventListener("resize", updateChatMinHeight);
    };
  }, [payload.meta.character_image, questionHtml]);

  function submitAnswer() {
    if (!canSubmit || !payload.handler_urls.get_response) {
      return;
    }

    const userInput = draft;
    const nextMessages = messages.concat({
      source: "user",
      content: userInput,
    });

    setMessages(nextMessages);
    setDraft("");
    setPending(true);
    setStatusMessage(
      intl.formatMessage({
        id: "shortanswer.student.sending",
        defaultMessage: "Sending message...",
      }),
    );

    postJson<ShortAnswerResponse>(payload.handler_urls.get_response, {
      user_input: userInput,
    })
      .then((response) => {
        setMessages(
          nextMessages.concat({
            source: "llm",
            content: response.response || "",
          }),
        );
        setPending(false);
        setStatusMessage(
          intl.formatMessage({
            id: "shortanswer.student.responseReady",
            defaultMessage: "Assistant response ready.",
          }),
        );

        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      })
      .catch((error: unknown) => {
        const fallbackError = intl.formatMessage({
          id: "shortanswer.student.requestErrorAlert",
          defaultMessage: "An error has occurred.",
        });

        setMessages(messages);
        setDraft(userInput);
        setPending(false);
        setStatusMessage(
          intl.formatMessage({
            id: "shortanswer.student.requestErrorStatus",
            defaultMessage: "Unable to process your message. Please try again.",
          }),
        );

        window.alert(getErrorMessage(error, fallbackError));
      });
  }

  function resetConversation() {
    if (!canReset || !payload.handler_urls.reset) {
      return;
    }

    setPending(true);
    setStatusMessage(
      intl.formatMessage({
        id: "shortanswer.student.resetting",
        defaultMessage: "Resetting chat...",
      }),
    );

    postJson(payload.handler_urls.reset, {})
      .then(() => {
        setMessages([]);
        setPending(false);
        setStatusMessage(
          intl.formatMessage({
            id: "shortanswer.student.resetDone",
            defaultMessage: "Chat reset. Start typing a new response.",
          }),
        );

        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      })
      .catch((error: unknown) => {
        const fallbackError = intl.formatMessage({
          id: "shortanswer.student.requestErrorAlert",
          defaultMessage: "An error has occurred.",
        });

        setPending(false);
        setStatusMessage(
          intl.formatMessage({
            id: "shortanswer.student.resetErrorStatus",
            defaultMessage: "Unable to reset the chat. Please try again.",
          }),
        );

        window.alert(getErrorMessage(error, fallbackError));
      });
  }

  return (
    <section className="shortanswer-react-app" data-block-kind="shortanswer" data-view={payload.view}>
      {payload.meta.character_image ? (
        <div className="shortanswer_image">
          <img
            ref={imageRef}
            src={payload.meta.character_image}
            alt=""
            onLoad={() => {
              const imageElement = imageRef.current;
              const questionElement = questionRef.current;
              if (!imageElement || !questionElement) {
                setChatMinHeight(null);
                return;
              }
              const nextMinHeight = imageElement.height - questionElement.offsetHeight;
              setChatMinHeight(nextMinHeight > 0 ? nextMinHeight : null);
            }}
          />
        </div>
      ) : null}

      <div className="shortanswer_block">
        <QuestionPanel questionHtml={questionHtml} questionRef={questionRef} />
        <div id="chatbox">
          <MessageList
            messages={messages}
            minHeight={chatMinHeight}
            pending={pending}
            historyRef={historyRef}
          />
          <StatusRegion message={statusMessage} />
          <MessageComposer
            allowReset={allowReset}
            canReset={canReset}
            canSubmit={canSubmit}
            disabled={controlsDisabled}
            draft={draft}
            instructionsId={instructionsId}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submitAnswer();
              }
            }}
            onReset={resetConversation}
            onSubmit={submitAnswer}
            textareaRef={textareaRef}
          />
        </div>
      </div>
    </section>
  );
}
