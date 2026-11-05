import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Collapsible, Form, Icon } from "@openedx/paragon";
import { useIntl } from "react-intl";

import { renderMarkdown } from "../shared/renderMarkdown";
import { sendAnswer, resetChat } from "./api";
import { ShortAnswerMessage, ShortAnswerStudentPayload } from "./types";
import { ArrowUpward, AutoAwesome, KeyboardArrowDown, KeyboardArrowUp, RestartAlt } from "@openedx/paragon/icons";
import { getBackgroundOption } from "./appearance";
import { PoweredByAI } from "../shared/PoweredByAI";
import { TypingIndicator } from "../shared/TypingIndicator";
import { DownloadPDFSection } from "../shared/DownloadPDFSection";
import { ConfirmResetModal } from "../shared/ConfirmResetModal";
import { ErrorData, GenericErrorAlert } from "../shared/error";

function countUserMessages(messages: ShortAnswerMessage[]) {
  return messages.reduce((count, message) => {
    return count + (message.source === "user" ? 1 : 0);
  }, 0);
}

interface QuestionPanelProps {
  questionHtml: string;
  questionRef: React.RefObject<HTMLDivElement>;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

function QuestionPanel(
  { questionHtml, questionRef, isOpen, setIsOpen }: QuestionPanelProps
) {

  // Extract the first element out of the question html
  // to display it as the preview on the Collapsible.
  const tmpWrapper = document.createElement('div');
  tmpWrapper.innerHTML = questionHtml;
  const truncatedQuestionHtml = tmpWrapper.firstElementChild?.outerHTML || "";
  tmpWrapper.firstElementChild?.remove();
  const remainingQuestionHtml = tmpWrapper.innerHTML;

  return (
    <Collapsible.Advanced
        open={isOpen}
        onToggle={(isOpen: boolean) => setIsOpen(isOpen)}
        ref={questionRef} className="shortanswer-question"
      >
        <Collapsible.Trigger className="shortanswer-question-trigger">
          <span className="shortanswer-question-toggle" aria-hidden="true">
            <Collapsible.Visible whenClosed><Icon src={KeyboardArrowDown} /></Collapsible.Visible>
            <Collapsible.Visible whenOpen><Icon src={KeyboardArrowUp} /></Collapsible.Visible>
          </span>
          <div dangerouslySetInnerHTML={{ __html: truncatedQuestionHtml }} />
        </Collapsible.Trigger>
        <Collapsible.Body className="shortanswer-question-body">
          <div dangerouslySetInnerHTML={{ __html: remainingQuestionHtml }} />
        </Collapsible.Body>
      </Collapsible.Advanced>
  );
}

function MessageList({
  messages,
  pending,
}: {
  messages: ShortAnswerMessage[];
  pending: boolean;
}) {
  const renderedMessages = useMemo(
    () => messages.map((msg) => renderMarkdown(msg.content)),
    [messages],
  );

  return (
    <div
      className="chat-history"
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
            <div
              className={"chat-message " + messageClassName}
              dangerouslySetInnerHTML={{ __html: renderedMessages[index] }}
            />
          </div>
        );
      })}
      {pending && <TypingIndicator />}
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
  canSubmit,
  characterLimit,
  disabled,
  draft,
  onChange,
  onSubmit,
  textareaRef,
}: {
  canSubmit: boolean;
  characterLimit: number;
  disabled: boolean;
  draft: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const intl = useIntl();
  const sendLabel = intl.formatMessage({
    id: "shortanswer.student.submit",
    defaultMessage: "Submit",
  });

  return (
    <React.Fragment>
      <div className="chat-submit-row">
        <div className="chat-input-wrapper">
          <Form.Control
            ref={textareaRef}
            rows={1}
            disabled={disabled}
            as="textarea"
            autoResize
            aria-label={intl.formatMessage({ id: "shortanswer.student.answer", defaultMessage: "Your answer" })}
            placeholder={intl.formatMessage({
              id: "shortanswer.student.placeholder",
              defaultMessage: "Type your answer here. Ctrl+Enter to send, Shift+Enter for new line.",
            })}
            maxLength={characterLimit}
            value={draft}
            onChange={onChange}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className={"chat-send-button" + (canSubmit ? "" : " disabled")}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            aria-label={sendLabel}
            onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
              // Prevent the button from being focused when clicked.
              e.preventDefault();
            }}
            onClick={onSubmit}
          >
            <Icon src={ArrowUpward} />
          </Button>
        </div>
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
  const initialMessages = useMemo(
    () => payload.initial_state.messages || [],
    [payload.initial_state.messages],
  );
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const questionHtml = useMemo(() => renderMarkdown(payload.meta.question), [payload.meta.question]);
  const headerId = useId();
  const headerTitle = payload.meta.title?.trim() || intl.formatMessage({
    id: "shortanswer.student.title", defaultMessage: "AI Discussion",
  });
  const background = getBackgroundOption(payload.meta.background_theme);
  const resetLabel = intl.formatMessage({ id: "shortanswer.student.reset", defaultMessage: "Reset chat" });
  const historyRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userMessageCount = countUserMessages(messages);
  const maxResponses = Number(payload.meta.max_responses || 0);
  const characterLimit = payload.meta.character_limit;
  const allowReset = Boolean(payload.meta.allow_reset);
  const hideQuestion = Boolean(payload.meta.hide_question);
  const canSubmit = !pending && draft.length > 0 && userMessageCount < maxResponses;
  const canReset = allowReset && !pending && userMessageCount > 0;
  const controlsDisabled = userMessageCount >= maxResponses;
  // question panel should only default to open if user has not already send a message
  const [questionPanelIsOpen, setQuestionPanelIsOpen] = React.useState(userMessageCount == 0 ? true : false);
  const [errorData, setErrorData] = React.useState<ErrorData | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [resetConfirmTarget, setResetConfirmTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages, pending]);

  async function submitAnswer() {
    if (!canSubmit) {
      return;
    }

    // Collapse the question panel when sending the first message,
    // and only the first message to avoid this being annoying.
    if (messages.length == 0) {
      setQuestionPanelIsOpen(false);
    }

    const userInput = draft;
    const nextMessages = messages.concat({
      source: "user",
      content: userInput,
    });

    setMessages(nextMessages);

    setDraft("");

    // This is a hacky workaround for the issue where the textarea doesn't auto-resize when the value is set externally.
    // https://github.com/openedx/paragon/issues/4319
    // Force resize on next tick so scrollHeight is updated, mimicking the textarea's
    // handleResize event.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        // @ts-ignore
        el.style.height = `${el.initialHeight || 0}px`;
        // @ts-ignore
        el.style.height = `${el.scrollHeight + (el.offsets || 0)}px`;
      }
    });

    setErrorData(null);  // clear the error data while we try a new action
    setPending(true);
    setStatusMessage(
      intl.formatMessage({
        id: "shortanswer.student.sending",
        defaultMessage: "Sending message...",
      }),
    );

    try {
      const llmContent = await sendAnswer(payload.handler_urls.get_response, userInput);
      setMessages(
        nextMessages.concat({
          source: "llm",
          content: llmContent,
        }),
      );
      setPending(false);
      setStatusMessage(
        intl.formatMessage({
          id: "shortanswer.student.responseReady",
          defaultMessage: "Assistant response ready.",
        }),
      );
    } catch (error: any) {
      setMessages(messages);
      setDraft((current) => current || userInput);
      setPending(false);

      setErrorData({
        title: intl.formatMessage({
          id: "shortanswer.student.unableToSend",
          defaultMessage: "Unable to send message",
        }),
        message: error.toString(),
      });
    }

  }

  async function resetConversation() {
    if (!canReset) {
      return;
    }

    setErrorData(null);  // clear the error data while we try a new action
    setPending(true);
    setStatusMessage(
      intl.formatMessage({
        id: "shortanswer.student.resetting",
        defaultMessage: "Resetting chat...",
      }),
    );

    try {
      await resetChat(payload.handler_urls.reset);
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

      // After reset, re-open the question panel for convenience.
      setQuestionPanelIsOpen(true);
    } catch (error: any) {
      setPending(false);

      setErrorData({
        title: intl.formatMessage({
          id: "shortanswer.student.unableToReset",
          defaultMessage: "Unable to reset the chat",
        }),
        message: error.toString(),
      });
    }
  }

  return (
    <section
      className="shortanswer-react-app"
      data-block-kind="shortanswer"
      data-view={payload.view}
      data-background-theme={background.value}
      style={{ backgroundColor: background.color }}
      aria-labelledby={headerId}
    >
      <div className="shortanswer_block">
        <header className="shortanswer-header">
          <span className="shortanswer-header-icon" aria-hidden="true"><Icon src={AutoAwesome} /></span>
          <h2 id={headerId} className="shortanswer-header-title">{headerTitle}</h2>
          {allowReset && (
            <Button
              type="button"
              variant="tertiary"
              className="shortanswer-reset"
              disabled={!canReset}
              aria-disabled={!canReset}
              aria-label={resetLabel}
              title={resetLabel}
              onClick={() => setShowConfirmReset(true)}
              ref={setResetConfirmTarget}
            >
              <Icon src={RestartAlt} />
            </Button>
          )}
        </header>

        <div className={"shortanswer-layout" + (payload.meta.character_image ? " shortanswer-layout--with-image" : "")}>
          {payload.meta.character_image && (
            <div className="shortanswer-character"><img src={payload.meta.character_image} alt="" /></div>
          )}
          <div className="shortanswer-panel">
            <div className="shortanswer-conversation" ref={historyRef}>
              {!hideQuestion && (
                <QuestionPanel
                  isOpen={questionPanelIsOpen}
                  setIsOpen={setQuestionPanelIsOpen}
                  questionHtml={questionHtml}
                  questionRef={questionRef}
                />
              )}
              <MessageList messages={messages} pending={pending} />
            </div>
            <StatusRegion message={statusMessage} />
            <MessageComposer
              canSubmit={canSubmit}
              characterLimit={characterLimit}
              disabled={controlsDisabled}
              draft={draft}
              onChange={(event) => setDraft(event.target.value)}
              onSubmit={submitAnswer}
              textareaRef={textareaRef}
            />
            <PoweredByAI className="shortanswer-attribution" />
          </div>
        </div>

        <ConfirmResetModal
          positionRef={resetConfirmTarget}
          placement="bottom-end"
          isOpen={showConfirmReset}
          title={intl.formatMessage({ id: "shortanswer.reset.title", defaultMessage: "Restart interactive?" })}
          body={intl.formatMessage({
            id: "shortanswer.reset.body",
            defaultMessage: "If you restart, your progress in this interactive will be lost.",
          })}
          confirmLabel={intl.formatMessage({ id: "shortanswer.reset.confirm", defaultMessage: "Restart" })}
          cancelLabel={intl.formatMessage({ id: "shortanswer.reset.cancel", defaultMessage: "Stay" })}
          confirmVariant="brand"
          dialogClassName="shortanswer-reset-dialog"
          onConfirm={() => {
            setShowConfirmReset(false);
            resetConversation();
          }}
          onCancel={() => setShowConfirmReset(false)}
        />

        {errorData &&
          <GenericErrorAlert
            error={errorData}
            onClose={() => setErrorData(null)}
          />
        }

        {messages.length >= 2 && payload.meta.pdf_download_allowed && <DownloadPDFSection pdfUrl={payload.handler_urls.download_pdf} title={payload.meta.pdf_download_title} description={payload.meta.pdf_download_description} />}
      </div>

    </section>
  );
}
