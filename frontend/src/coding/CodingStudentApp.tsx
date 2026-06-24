import React, { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Spinner, useArrowKeyNavigation } from "@openedx/paragon";

import { getErrorMessage } from "../shared/request";
import { renderMarkdown } from "../shared/renderMarkdown";
import {
  fetchAiFeedback,
  pollSubmissionResult,
  resetCodingSession,
  submitCode,
  wait,
  WAIT_TIME_MS,
} from "./api";
import { CodingStudentPayload } from "./types";
import { PoweredByAI } from "../shared/PoweredByAI";
import { DownloadPDFSection } from "../shared/DownloadPDFSection";

const HTML_CSS = "HTML/CSS";
const HTML_PLACEHOLDER =
  "<!DOCTYPE html>\n<html>\n<head>\n<style>\nbody {background: linear-gradient(90deg, #ffecd2, #fcb69f);}\nh1   {font-style: italic;}\np    {border: 2px solid powderblue;}\n</style>\n</head>\n<body>\n<h1>This is a heading</h1>\n<p>This is a paragraph.</p>\n</body>\n</html>";

interface MonacoEditorInstance {
  focus: () => void;
  getValue: () => string;
  onDidChangeModelContent?: (listener: () => void) => { dispose?: () => void } | void;
  setValue: (value: string) => void;
}

interface MonacoEditorAdapter {
  focus: () => void;
  getValue: () => string;
  onDidChangeModelContent: (listener: () => void) => (() => void) | void;
  setValue: (value: string) => void;
}

function stripScriptTags(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;

  const scripts = container.getElementsByTagName("script");
  while (scripts.length > 0) {
    scripts[0].parentNode?.removeChild(scripts[0]);
  }

  return container.innerHTML;
}

function StatusRegion({ message }: { message: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {message}
    </div>
  );
}

function QuestionPanel({ questionHtml }: { questionHtml: string }) {
  return <div id="question-text" dangerouslySetInnerHTML={{ __html: questionHtml }} />;
}

function ActionBar({
  pending,
  onReset,
  onSubmit,
}: {
  pending: boolean;
  onReset: () => void;
  onSubmit: () => void;
}) {
  const intl = useIntl();

  return (
    <div className="eval-ai-buttons">
      <button
        id="reset-button"
        type="button"
        className={"eval-ai-button" + (pending ? " disabled-btn" : "")}
        disabled={pending}
        onClick={onReset}
      >
        {intl.formatMessage({
          id: "coding.student.reset",
          defaultMessage: "Reset",
        })}
      </button>
      <button
        id="submit-button"
        type="button"
        className={"eval-ai-button btn btn-primary" + (pending ? " disabled-btn" : "")}
        disabled={pending}
        onClick={onSubmit}
      >
        {intl.formatMessage({
          id: "coding.student.submit",
          defaultMessage: "Submit Code",
        })}
        {pending ? (
          <Spinner
            animation="border"
            size="sm"
            className="submit-loader"
            screenReaderText={intl.formatMessage({
              id: "coding.student.submittingSpinner",
              defaultMessage: "Submitting…",
            })}
          />
        ) : null}
      </button>
    </div>
  );
}

function EditorPane({
  ariaDescribedBy,
  language,
  monacoHtml,
  onEditorReady,
  usageId,
}: {
  ariaDescribedBy: string;
  language: string;
  monacoHtml?: string;
  onEditorReady: (editor: MonacoEditorAdapter) => void;
  usageId: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onEditorReadyRef = useRef(onEditorReady);

  useEffect(() => {
    onEditorReadyRef.current = onEditorReady;
  }, [onEditorReady]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data !== usageId) {
        return;
      }

      const contentWindow = iframeRef.current ? iframeRef.current.contentWindow : null;
      const editorWindow = contentWindow as
        | (Window & { editor?: MonacoEditorInstance })
        | null;
      const editor = editorWindow?.editor;
      if (!editor) {
        return;
      }

      onEditorReadyRef.current({
        focus: () => {
          editor.focus();
        },
        getValue: () => {
          return editor.getValue();
        },
        onDidChangeModelContent: (listener) => {
          const disposable = editor.onDidChangeModelContent?.(listener);
          return () => {
            disposable?.dispose?.();
          };
        },
        setValue: (value) => {
          editor.setValue(value);
        },
      });
    }

    window.addEventListener("message", handleMessage);

    if (iframeRef.current) {
      iframeRef.current.srcdoc = (monacoHtml || "").replace(
        "__USAGE_ID_PLACEHOLDER__",
        usageId,
      );
    }

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [monacoHtml, usageId]);

  return (
    <iframe
      id="monaco"
      ref={iframeRef}
      frameBorder="0"
      scrolling="no"
      aria-describedby={ariaDescribedBy}
      title={language}
    />
  );
}

function OutputTab({
  language,
  previewHtml,
  stderr,
  stdout,
}: {
  language: string;
  previewHtml: string;
  stderr: string;
  stdout: string;
}) {
  if (language === HTML_CSS) {
    return <iframe className="html-render" scrolling="no" frameBorder="0" srcDoc={previewHtml} />;
  }

  return (
    <React.Fragment>
      <div className="stdout">{stdout}</div>
      <div className="stderr">{stderr}</div>
    </React.Fragment>
  );
}

function AIFeedbackTab({ feedbackHtml }: { feedbackHtml: string }) {
  return <div dangerouslySetInnerHTML={{ __html: feedbackHtml }} />;
}

function ResultsPanel({
  activeTab,
  aiFeedbackHtml,
  feedbackTabId,
  feedbackTabRef,
  hasFeedbackNotification,
  onActivateTab,
  outputPanelId,
  outputTabId,
  outputTabRef,
  pending,
  previewHtml,
  resultPanelId,
  stderr,
  stdout,
  language,
}: {
  activeTab: "output" | "feedback";
  aiFeedbackHtml: string;
  feedbackTabId: string;
  feedbackTabRef: React.RefObject<HTMLButtonElement>;
  hasFeedbackNotification: boolean;
  language: string;
  onActivateTab: (tab: "output" | "feedback", focusTab?: boolean) => void;
  outputPanelId: string;
  outputTabId: string;
  outputTabRef: React.RefObject<HTMLButtonElement>;
  pending: boolean;
  previewHtml: string;
  resultPanelId: string;
  stderr: string;
  stdout: string;
}) {
  const intl = useIntl();
  const tablistRef = useArrowKeyNavigation({ selectors: "button" });

  return (
    <div className="result" id={resultPanelId} aria-live="polite" aria-busy={pending ? "true" : undefined}>
      <div
        className="tab"
        role="tablist"
        ref={tablistRef as React.Ref<HTMLDivElement>}
        aria-label={intl.formatMessage({
          id: "coding.student.tabListLabel",
          defaultMessage: "Code evaluation panels",
        })}
      >
        <button
          ref={outputTabRef}
          type="button"
          className={"result-tab-btn" + (activeTab === "output" ? " active" : "")}
          id={outputTabId}
          role="tab"
          aria-controls={outputPanelId}
          aria-selected={activeTab === "output"}
          tabIndex={activeTab === "output" ? 0 : -1}
          onClick={() => {
            onActivateTab("output", true);
          }}
        >
          {intl.formatMessage({
            id: "coding.student.outputTab",
            defaultMessage: "Output",
          })}
        </button>
        <button
          ref={feedbackTabRef}
          type="button"
          className={
            "result-tab-btn" +
            (activeTab === "feedback" ? " active" : "") +
            (hasFeedbackNotification && activeTab !== "feedback"
              ? " result-tab-btn--notify"
              : "")
          }
          id={feedbackTabId}
          role="tab"
          aria-controls={resultPanelId + "-feedback"}
          aria-selected={activeTab === "feedback"}
          tabIndex={activeTab === "feedback" ? 0 : -1}
          onClick={() => {
            onActivateTab("feedback", true);
          }}
        >
          {intl.formatMessage({
            id: "coding.student.feedbackTab",
            defaultMessage: "AI feedback",
          })}
        </button>
      </div>

      <div
        id={outputPanelId}
        className="tabcontent"
        role="tabpanel"
        aria-labelledby={outputTabId}
        aria-hidden={activeTab === "output" ? "false" : "true"}
        hidden={activeTab !== "output"}
      >
        <OutputTab
          language={language}
          previewHtml={previewHtml}
          stderr={stderr}
          stdout={stdout}
        />
      </div>

      <div
        id={resultPanelId + "-feedback"}
        className="tabcontent"
        role="tabpanel"
        aria-labelledby={feedbackTabId}
        aria-hidden={activeTab === "feedback" ? "false" : "true"}
        hidden={activeTab !== "feedback"}
      >
        <AIFeedbackTab feedbackHtml={aiFeedbackHtml} />
      </div>
    </div>
  );
}

export default function CodingStudentApp({
  payload,
  usageId,
}: {
  payload: CodingStudentPayload;
  usageId: string;
}) {
  const intl = useIntl();
  const editorRef = useRef<MonacoEditorAdapter | null>(null);
  const editorPreviewCleanupRef = useRef<(() => void) | null>(null);
  const initializedEditorRef = useRef(false);
  const initialCode = payload.initial_state.code || "";
  const initialFeedback = payload.initial_state.ai_evaluation || "";
  const initialExecutionResult = payload.initial_state.code_exec_result || { stderr: "", stdout: "" };
  const questionHtml = useMemo(() => renderMarkdown(payload.meta.question), [payload.meta.question]);
  const [feedbackMarkdown, setFeedbackMarkdown] = useState(initialFeedback);
  const feedbackHtml = useMemo(() => renderMarkdown(feedbackMarkdown), [feedbackMarkdown]);
  const [stdout, setStdout] = useState(initialExecutionResult.stdout || "");
  const [stderr, setStderr] = useState(initialExecutionResult.stderr || "");
  const [previewHtml, setPreviewHtml] = useState("");
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"output" | "feedback">("output");
  const [hasFeedbackNotification, setHasFeedbackNotification] = useState(Boolean(initialFeedback));
  const outputTabRef = useRef<HTMLButtonElement>(null);
  const feedbackTabRef = useRef<HTMLButtonElement>(null);
  const outputTabId = "coding-output-tab-" + usageId;
  const feedbackTabId = "coding-feedback-tab-" + usageId;
  const outputPanelId = "coding-output-panel-" + usageId;
  const instructionsId = "coding-instructions-" + usageId;
  const resultPanelId = "coding-results-" + usageId;
  const language = payload.meta.language;

  useEffect(() => {
    return () => {
      editorPreviewCleanupRef.current?.();
    };
  }, []);

  function focusActiveTab(tab: "output" | "feedback") {
    if (tab === "output") {
      outputTabRef.current?.focus();
      return;
    }

    feedbackTabRef.current?.focus();
  }

  function activateTab(tab: "output" | "feedback", focusTab?: boolean) {
    setActiveTab(tab);
    if (tab === "feedback") {
      setHasFeedbackNotification(false);
    }
    if (focusTab) {
      window.setTimeout(() => {
        focusActiveTab(tab);
      }, 0);
    }
  }

  function onEditorReady(editor: MonacoEditorAdapter) {
    editorRef.current = editor;

    if (initializedEditorRef.current) {
      return;
    }

    initializedEditorRef.current = true;

    if (initialCode) {
      editor.setValue(initialCode);
    }

    if (language === HTML_CSS) {
      const startingHtml = initialCode || HTML_PLACEHOLDER;
      if (!initialCode) {
        editor.setValue(startingHtml);
      }
      setPreviewHtml(stripScriptTags(startingHtml));
      editorPreviewCleanupRef.current = editor.onDidChangeModelContent(() => {
        setPreviewHtml(stripScriptTags(editor.getValue()));
      }) || null;
    } else {
      setStdout(initialExecutionResult.stdout || "");
      setStderr(initialExecutionResult.stderr || "");
    }
  }

  function resetVisualState() {
    setFeedbackMarkdown("");
    setHasFeedbackNotification(false);
    setStdout("");
    setStderr("");
    setPreviewHtml("");
    setActiveTab("output");
  }

  async function getAiFeedback(stdout: string, stderr: string) {
    const nextFeedback = await fetchAiFeedback(
      payload.handler_urls.get_response,
      editorRef.current?.getValue() || "",
      stdout,
      stderr,
    );
    setFeedbackMarkdown(nextFeedback);
    if (activeTab !== "feedback") {
      setHasFeedbackNotification(Boolean(nextFeedback));
    }
    setStatusMessage(
      intl.formatMessage({
        id: "coding.student.feedbackReady",
        defaultMessage: "AI feedback ready. Activate the AI feedback tab to review.",
      }),
    );
  }

  async function handleSubmit() {
    if (pending) {
      return;
    }

    const code = editorRef.current?.getValue() || "";
    if (!code.length) {
      setStatusMessage(
        intl.formatMessage({
          id: "coding.student.enterCode",
          defaultMessage: "Enter code before submitting.",
        }),
      );
      try {
        editorRef.current?.focus();
      } catch (error) {
        // ignore focus errors
      }
      return;
    }

    setHasFeedbackNotification(false);
    setStatusMessage(
      intl.formatMessage({
        id: "coding.student.submitting",
        defaultMessage: "Submitting code...",
      }),
    );
    setPending(true);

    try {
      if (language === HTML_CSS) {
        setStatusMessage(
          intl.formatMessage({
            id: "coding.student.generatingFeedback",
            defaultMessage: "Generating AI feedback...",
          }),
        );
        await getAiFeedback("", "");
      } else {
        const submission = await submitCode(payload.handler_urls.submit_code_handler, code);
        if (!submission.submission_id) {
          throw new Error(
            intl.formatMessage({
              id: "coding.student.invalidSubmissionResponse",
              defaultMessage: "Code submission failed. Please try again.",
            }),
          );
        }
        setStatusMessage(
          intl.formatMessage({
            id: "coding.student.checkingResults",
            defaultMessage: "Code submitted. Checking execution results...",
          }),
        );
        await wait(WAIT_TIME_MS * 2);
        const result = await pollSubmissionResult(
          payload.handler_urls.get_submission_result_handler,
          submission.submission_id,
        );
        const output = [result.compile_output, result.stdout].join("\n").trim();
        setStdout(output);
        setStderr(result.stderr || "");
        setStatusMessage(
          intl.formatMessage({
            id: "coding.student.executionComplete",
            defaultMessage: "Execution complete. Output tab updated.",
          }),
        );
        await getAiFeedback(output, result.stderr || "");
      }
    } catch (error: unknown) {
      const fallbackMessage = intl.formatMessage({
        id: "coding.student.submitError",
        defaultMessage: "A problem occurred while submitting the code.",
      });
      const message = getErrorMessage(error, fallbackMessage);
      setStatusMessage(message);
      window.alert(message);
    } finally {
      setPending(false);
    }
  }

  async function handleReset() {
    if (pending) {
      return;
    }

    setPending(true);
    setStatusMessage(
      intl.formatMessage({
        id: "coding.student.resetting",
        defaultMessage: "Resetting editor...",
      }),
    );

    try {
      await resetCodingSession(payload.handler_urls.reset_handler);
      editorRef.current?.setValue("");
      resetVisualState();
      setStatusMessage(
        intl.formatMessage({
          id: "coding.student.resetDone",
          defaultMessage: "Editor reset. Previous output cleared.",
        }),
      );
      try {
        editorRef.current?.focus();
      } catch (error) {
        // ignore focus errors
      }
    } catch (error: unknown) {
      const message = getErrorMessage(
        error,
        intl.formatMessage({
          id: "coding.student.resetError",
          defaultMessage: "A problem occurred during reset.",
        }),
      );
      setStatusMessage(message);
      window.alert(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="coding-react-app" data-block-kind="coding" data-view={payload.view}>
      <QuestionPanel questionHtml={questionHtml} />
      <div className="coding-instructions" id={instructionsId}>
        <p>
          {intl.formatMessage({
            id: "coding.student.instructions",
            defaultMessage:
              "Press Alt+F1 for editor accessibility help. Press Tab to move out of the editor and use the Submit Code button to run your program.",
          })}
        </p>
      </div>
      <StatusRegion message={statusMessage} />
      <div className="eval-ai-container">
        <div className="eval-ai-code-editor">
          <div className="used-prog-language">
            <span>{language}</span>
          </div>
          <EditorPane
            ariaDescribedBy={instructionsId}
            language={language}
            monacoHtml={payload.meta.monaco_html}
            onEditorReady={onEditorReady}
            usageId={usageId}
          />
          <ActionBar pending={pending} onReset={handleReset} onSubmit={handleSubmit} />
        </div>

        <ResultsPanel
          activeTab={activeTab}
          aiFeedbackHtml={feedbackHtml}
          feedbackTabId={feedbackTabId}
          feedbackTabRef={feedbackTabRef}
          hasFeedbackNotification={hasFeedbackNotification}
          language={language}
          onActivateTab={activateTab}
          outputPanelId={outputPanelId}
          outputTabId={outputTabId}
          outputTabRef={outputTabRef}
          pending={pending}
          previewHtml={previewHtml}
          resultPanelId={resultPanelId}
          stderr={stderr}
          stdout={stdout}
        />
      </div>

      <PoweredByAI />

      {feedbackHtml && payload.meta.pdf_download_allowed && <DownloadPDFSection pdfUrl={payload.handler_urls.download_pdf} title={payload.meta.pdf_download_title} description={payload.meta.pdf_download_description} />}
    </section>
  );
}
