import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Col, Collapsible, Form, Icon, Row } from "@openedx/paragon";
import { useIntl } from "react-intl";

import { renderMarkdown } from "../shared/renderMarkdown";
import { sendAnswer, resetChat } from "./api";
import { ShortAnswerMessage, ShortAnswerStudentPayload } from "./types";
import { ArrowUpward, KeyboardArrowDown, KeyboardArrowUp } from "@openedx/paragon/icons";
import { PoweredByAI } from "../shared/PoweredByAI";
import { TypingIndicator } from "../shared/TypingIndicator";
import { DownloadPDFSection } from "../shared/DownloadPDFSection";
import { ErrorData, GenericErrorAlert } from "../shared/error";

function countUserMessages(messages: ShortAnswerMessage[]) {
  return messages.reduce((count, message) => {
    return count + (message.source === "user" ? 1 : 0);
  }, 0);
}

interface QuestionPanelProps {
  title: string;
  questionHtml: string;
  questionRef: React.RefObject<HTMLDivElement>;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

function QuestionPanel(
  { title, questionHtml, questionRef, isOpen, setIsOpen }: QuestionPanelProps
) {

  // Extract the first element out of the question html
  // to display it as the preview on the Collapsible.
  const tmpWrapper = document.createElement('div');
  tmpWrapper.innerHTML = questionHtml;
  const truncatedQuestionHtml = tmpWrapper.firstElementChild?.outerHTML;
  tmpWrapper.firstElementChild?.remove();
  const remainingQuestionHtml = tmpWrapper.innerHTML;

  return (
    <>
      {title && <h4 className="text-secondary-500">{title}</h4>}
      <Collapsible.Advanced
        open={isOpen}
        onToggle={(isOpen: boolean) => setIsOpen(isOpen)}
        ref={questionRef} className="shortanswer-question"
      >
        <Collapsible.Trigger>
          <Row>
            <Col xs={1} className="pr-2 ml-n5">
                <Collapsible.Visible whenClosed>
                  <Icon className="ml-auto" src={KeyboardArrowDown} />
                </Collapsible.Visible>
                <Collapsible.Visible whenOpen>
                  <Icon className="ml-auto" src={KeyboardArrowUp} />
                </Collapsible.Visible>
            </Col>
            <Col
              xs={11} className="pl-0 font-weight-bold"
              dangerouslySetInnerHTML={{ __html: truncatedQuestionHtml }}
            />
          </Row>
        </Collapsible.Trigger>

        <Collapsible.Body>
          <Row>
            <Col xs={1} className="pr-2 ml-n5"></Col>
            <Col
              xs={11} className="pl-0"
              dangerouslySetInnerHTML={{ __html: remainingQuestionHtml }}
            />
          </Row>
          </Collapsible.Body>
      </Collapsible.Advanced>
    </>
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
        const messageClassName = message.source === "user" ? "user-answer p-3" : "ai-eval";

        return (
          <div className="chat-message-container" key={String(index)}>
            <div
              className={"mb-5 chat-message " + messageClassName}
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
  allowReset,
  canReset,
  canSubmit,
  characterLimit,
  disabled,
  draft,
  onChange,
  onReset,
  onSubmit,
  textareaRef,
}: {
  allowReset: boolean;
  canReset: boolean;
  canSubmit: boolean;
  characterLimit: number;
  disabled: boolean;
  draft: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onReset: () => void;
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
        {allowReset ? (
          <Button
            type="button"
            variant="outline-secondary"
            className="reset-btn rounded-pill"
            disabled={!canReset}
            aria-disabled={!canReset}
            onClick={onReset}
          >
            {intl.formatMessage({
              id: "shortanswer.student.reset",
              defaultMessage: "Reset chat",
            })}
          </Button>
        ) : null}
        <div className="chat-input-wrapper">
          <Form.Control
            ref={textareaRef}
            rows={1}
            disabled={disabled}
            as="textarea"
            autoResize
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
  const [chatMinHeight, setChatMinHeight] = useState<number | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
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

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

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
    <section className="shortanswer-react-app" data-block-kind="shortanswer" data-view={payload.view}>
      <div className="shortanswer_block">
        {!hideQuestion && (
          <QuestionPanel isOpen={questionPanelIsOpen} setIsOpen={setQuestionPanelIsOpen} title={payload.meta.title} questionHtml={questionHtml} questionRef={questionRef} />
        )}

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
            characterLimit={characterLimit}
            disabled={controlsDisabled}
            draft={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onReset={resetConversation}
            onSubmit={submitAnswer}
            textareaRef={textareaRef}
          />
        </div>

        {errorData &&
          <GenericErrorAlert
            error={errorData}
            onClose={() => setErrorData(null)}
          />
        }

        <PoweredByAI />

        {messages.length >= 2 && payload.meta.pdf_download_allowed && <DownloadPDFSection pdfUrl={payload.handler_urls.download_pdf} title={payload.meta.pdf_download_title} description={payload.meta.pdf_download_description} />}
      </div>

    </section>
  );
}
