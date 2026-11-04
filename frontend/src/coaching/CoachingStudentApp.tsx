import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ActionRow, Button, Icon, ModalCloseButton, ModalPopup } from "@openedx/paragon";
import { PlayCircleFilled } from "@openedx/paragon/icons";
import { useIntl } from "react-intl";

import { ConfirmResetModal } from "../shared/ConfirmResetModal";
import { renderMarkdown } from "../shared/renderMarkdown";
import { CharacterResponse, requestEvaluation, resetAll, sendChatMessage } from "./api";
import {
  CoachingAttemptState,
  CoachingCharacter,
  CoachingFinalReport,
  CoachingMessage,
  CoachingStudentPayload,
} from "./types";
import { PoweredByAI } from "../shared/PoweredByAI";
import { TypingIndicator } from "../shared/TypingIndicator";
import { DownloadPDFSection } from "../shared/DownloadPDFSection";
import { ErrorData, GenericErrorAlert } from "../shared/error";
import { AttachmentChips } from "../shared/AttachmentChips";
import { AttachmentUploader } from "../shared/AttachmentUploader";
import { useAttachmentUploads } from "../shared/useAttachmentUploads";

type PaneKey = "workspace" | "coach";
type CoachMode = "chat" | "report" | "review";

const DEFAULT_ATTEMPTS: CoachingAttemptState = {
  attempts_remaining: null,
  attempts_used: 0,
  can_retry: true,
  max_attempts: 0,
};

interface PendingCoachingMessage extends CoachingMessage {
  pending?: boolean;
}

function splitHistories(chatHistories: CoachingMessage[][]) {
  return {
    workspace: chatHistories[0] as PendingCoachingMessage[],
    coach: chatHistories[1] as PendingCoachingMessage[],
  };
}

function toFinalReport(response: CharacterResponse): CoachingFinalReport | null {
  if (!response.report_html) {
    return null;
  }

  return {
    attempts: response.attempts || DEFAULT_ATTEMPTS,
    evaluation_markdown: response.evaluation_markdown || "",
    final_submission: response.final_submission || "",
    final_submission_attachments: response.final_submission_attachments || [],
    finished: Boolean(response.finished),
    report_html: response.report_html,
    show_report_card: Boolean(response.show_report_card),
  };
}

function autoResizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = String(textarea.scrollHeight) + "px";
}

function initialsForName(name?: string) {
  if (!name) {
    return "";
  }

  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function MessageAvatar({
  character,
}: {
  character: CoachingCharacter;
}) {
  const intl = useIntl();

  if (character.avatar) {
    return (
      <div className="coach-message__avatar">
        <img
          src={character.avatar}
          alt={intl.formatMessage(
            {
              id: "coaching.student.avatar",
              defaultMessage: "{name, select, none {Avatar} other {Avatar for {name}}}",
            },
            { name: character.name || "none" },
          )}
        />
      </div>
    );
  }

  if (character.name) {
    return (
      <div className="coach-message__avatar" aria-hidden="true">
        <span>{initialsForName(character.name)}</span>
      </div>
    );
  }

  return <div className="coach-message__avatar coach-message__avatar--empty" aria-hidden="true" />;
}

const ChatMessage = React.memo(function ChatMessage({ message }: { message: PendingCoachingMessage }) {
  const pane = message.pane === "coach" ? "coach" : "workspace";
  const isUser = Boolean(message.is_user);
  const character = message.character;
  const className = `coach-message coach-message--pane-${pane} ${isUser ? "coach-message--user" : "coach-message--ai"}${message.pending ? " coach-message--pending" : ""}`;

  const bubble = (
    <div className="coach-message__bubble">
      {!isUser && character.name ? (
        <div className="coach-message__meta">
          <span className="coach-message__name">{character.name}</span>
        </div>
      ) : null}
      <div
        className="coach-message__content"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
      />
    </div>
  );

  return (
    <div className={className}>
      {!isUser ? <MessageAvatar character={character} /> : null}
      {message.attachments?.length ? (
        <div className="coach-message__attachments">
          <AttachmentChips attachments={message.attachments} stacked={pane === "coach"} />
          {message.content ? bubble : null}
        </div>
      ) : bubble}
    </div>
  );
});

function ReportCard({
  evaluationHtml,
  onReviewConversation,
  report,
}: {
  evaluationHtml: string;
  onReviewConversation: () => void;
  report: CoachingFinalReport;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The server renders the submission section; the submitted files' chips are added to it.
  const [submissionSection, setSubmissionSection] = useState<Element | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    container.innerHTML = report.report_html || "";
    setSubmissionSection(container.querySelector(".coach-report-submission"));
    const evaluationNode = container.querySelector(".coach-report-card__evaluation");
    if (evaluationNode) {
      evaluationNode.innerHTML = evaluationHtml;
    }

    const reviewButton = container.querySelector(".coach-review-conversation");
    if (!(reviewButton instanceof HTMLElement)) {
      return undefined;
    }

    const handleClick = function handleClick(event: Event) {
      event.preventDefault();
      onReviewConversation();
    };

    reviewButton.addEventListener("click", handleClick);

    return () => {
      reviewButton.removeEventListener("click", handleClick);
    };
  }, [evaluationHtml, onReviewConversation, report.report_html]);

  return (
    <>
      <div ref={containerRef} />
      {submissionSection && report.final_submission_attachments.length > 0
        ? createPortal(<AttachmentChips attachments={report.final_submission_attachments} />, submissionSection)
        : null}
    </>
  );
}

function getInitialMode(finalReport: CoachingFinalReport | null) {
  if (finalReport && finalReport.report_html) {
    return "report";
  }

  return "chat";
}

export default function CoachingStudentApp({
  payload,
}: {
  payload: CoachingStudentPayload;
}) {
  const intl = useIntl();
  const initialHistories = useMemo(() => {
    return splitHistories(payload.initial_state.chat_histories);
  }, [payload.initial_state.chat_histories]);
  const initialAttempts = payload.initial_state.attempts;
  const initialFinalReport = payload.initial_state.final_report || null;
  const [histories, setHistories] = useState(initialHistories);
  const [attempts, setAttempts] = useState(
    initialFinalReport?.attempts ? initialFinalReport.attempts : initialAttempts,
  );
  const [finished, setFinished] = useState(Boolean(payload.initial_state.finished));
  const [mode, setMode] = useState<CoachMode>(getInitialMode(initialFinalReport) as CoachMode);
  const [report, setReport] = useState<CoachingFinalReport | null>(initialFinalReport);
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [coachDraft, setCoachDraft] = useState("");
  const [busyByPane, setBusyByPane] = useState({
    coach: false,
    workspace: false,
  });
  const [evaluationPending, setEvaluationPending] = useState(false);
  const [confirmType, setConfirmType] = useState<"reset" | "submit" | null>(null);
  const [resetConfirmTarget, setResetConfirmTarget] = useState<HTMLElement | null>(null);
  const [submitConfirmTarget, setSubmitConfirmTarget] = useState<HTMLElement | null>(null);
  const [statusByPane, setStatusByPane] = useState({
    coach: "",
    workspace: "",
  });
  const [errorData, setErrorData] = React.useState<ErrorData | null>(null);
  const workspaceUploads = useAttachmentUploads({
    pane: "workspace",
    paneState: payload.initial_state.uploads.workspace,
    fileLimits: payload.initial_state.uploads,
    handlerUrls: payload.handler_urls,
  });
  const coachUploads = useAttachmentUploads({
    pane: "coach",
    paneState: payload.initial_state.uploads.coach,
    fileLimits: payload.initial_state.uploads,
    handlerUrls: payload.handler_urls,
  });
  const uploadsByPane = { workspace: workspaceUploads, coach: coachUploads };
  const workspaceHistoryRef = useRef<HTMLDivElement>(null);
  const coachHistoryRef = useRef<HTMLDivElement>(null);
  const workspaceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const coachTextareaRef = useRef<HTMLTextAreaElement>(null);
  const backToReportRef = useRef<HTMLButtonElement>(null);
  const meta = payload.meta;
  const titles = meta.titles;
  const allowReset = meta.allow_reset;
  const initialWorkspaceMessage =
    meta.initial_message && meta.initial_message.content
      ? meta.initial_message
      : null;
  const initialCoachMessage =
    meta.coach_initial_message && meta.coach_initial_message.content
      ? meta.coach_initial_message
      : null;
  const displayedWorkspaceMessages = initialWorkspaceMessage
    ? [initialWorkspaceMessage].concat(histories.workspace)
    : histories.workspace;
  const displayedCoachMessages = initialCoachMessage
    ? [initialCoachMessage].concat(histories.coach)
    : histories.coach;
  const attemptsUsed = typeof attempts.attempts_used === "number" ? attempts.attempts_used : 0;
  const attemptsRemaining =
    typeof attempts.attempts_remaining === "number" || attempts.attempts_remaining === null
      ? attempts.attempts_remaining
      : null;
  const workspaceInputVisible =
    mode === "chat" && !finished && (attemptsRemaining === null || attemptsRemaining > 0);
  const coachInputVisible = mode === "chat" && !finished;
  const canSubmitForEvaluation =
    mode === "chat" &&
    !finished &&
    attemptsUsed > 0 &&
    !busyByPane.workspace &&
    !workspaceUploads.uploading &&
    !evaluationPending;
  const resetDisabled =
    busyByPane.workspace || busyByPane.coach || workspaceUploads.uploading || coachUploads.uploading;
  const reviewMode = mode === "review";
  const reportMode = mode === "report";
  const evaluationHtml = useMemo(
    () => renderMarkdown(report?.evaluation_markdown || ""),
    [report?.evaluation_markdown],
  );

  useEffect(() => {
    setHistories(initialHistories);
    setAttempts(initialFinalReport?.attempts ? initialFinalReport.attempts : initialAttempts);
    setFinished(Boolean(payload.initial_state.finished));
    setMode(getInitialMode(initialFinalReport) as CoachMode);
    setReport(initialFinalReport);
    setWorkspaceDraft("");
    setCoachDraft("");
    setEvaluationPending(false);
  }, [
    initialAttempts,
    initialFinalReport,
    initialHistories,
    payload.initial_state.finished,
  ]);

  useEffect(() => {
    autoResizeTextarea(workspaceTextareaRef.current);
  }, [workspaceDraft]);

  useEffect(() => {
    autoResizeTextarea(coachTextareaRef.current);
  }, [coachDraft]);

  useEffect(() => {
    const history = workspaceHistoryRef.current;
    if (history) {
      history.scrollTop = history.scrollHeight;
    }
  }, [displayedWorkspaceMessages, mode, busyByPane.workspace]);

  useEffect(() => {
    const history = coachHistoryRef.current;
    if (history) {
      history.scrollTop = history.scrollHeight;
    }
  }, [displayedCoachMessages, mode, busyByPane.coach]);

  useEffect(() => {
    if (reviewMode) {
      backToReportRef.current?.focus();
    }
  }, [reviewMode]);

  function setPaneBusy(pane: PaneKey, nextBusy: boolean) {
    setBusyByPane((currentBusyByPane) => {
      return {
        ...currentBusyByPane,
        [pane]: nextBusy,
      };
    });
  }

  function setPaneStatus(pane: PaneKey, message: string) {
    setStatusByPane((currentStatusByPane) => {
      return {
        ...currentStatusByPane,
        [pane]: message,
      };
    });
  }

  function updateMessagePendingState(
    pane: PaneKey,
    content: string,
    pending: boolean,
  ) {
    setHistories((currentHistories) => {
      const nextMessages = currentHistories[pane].slice();
      const lastMessageIndex = nextMessages.length - 1;
      if (lastMessageIndex < 0) {
        return currentHistories;
      }

      const lastMessage = nextMessages[lastMessageIndex];
      if (!lastMessage || lastMessage.content !== content || !lastMessage.is_user) {
        return currentHistories;
      }

      nextMessages[lastMessageIndex] = {
        ...lastMessage,
        pending,
      };

      return {
        ...currentHistories,
        [pane]: nextMessages,
      };
    });
  }

  function removePendingMessage(pane: PaneKey, content: string) {
    setHistories((currentHistories) => {
      const nextMessages = currentHistories[pane].slice();
      const lastMessageIndex = nextMessages.length - 1;
      if (lastMessageIndex < 0) {
        return currentHistories;
      }

      const lastMessage = nextMessages[lastMessageIndex];
      if (!lastMessage || lastMessage.content !== content || !lastMessage.pending) {
        return currentHistories;
      }

      nextMessages.pop();
      return {
        ...currentHistories,
        [pane]: nextMessages,
      };
    });
  }

  function appendMessage(pane: PaneKey, message: CoachingMessage) {
    setHistories((currentHistories) => {
      return {
        ...currentHistories,
        [pane]: currentHistories[pane].concat(message),
      };
    });
  }

  function applyResponseState(response: CharacterResponse) {
    if (response.attempts) {
      setAttempts(response.attempts);
    }

    if (typeof response.finished !== "undefined") {
      setFinished(Boolean(response.finished));
    }
  }

  function handleChatResponse(pane: PaneKey, response: CharacterResponse, userInput: string) {
    updateMessagePendingState(pane, userInput, false);
    setPaneBusy(pane, false);
    applyResponseState(response);

    if (response.report_html) {
      const nextReport = toFinalReport(response);
      setReport(nextReport);
      setMode("report");
      setPaneStatus(
        "workspace",
        intl.formatMessage({
          id: "coaching.student.reportShown",
          defaultMessage: "Evaluation report shown.",
        }),
      );
      return;
    }

    if (response.message) {
      appendMessage(pane, response.message);
      setPaneStatus(
        pane,
        response.message.character?.name
          ? intl.formatMessage(
              {
                id: "coaching.student.newMessageFromName",
                defaultMessage: "New message from {name}",
              },
              { name: response.message.character?.name || "" },
            )
          : intl.formatMessage({
              id: "coaching.student.newMessage",
              defaultMessage: "New message received",
            }),
      );
    }
  }

  async function sendMessage(pane: PaneKey) {
    const handlerUrl = payload.handler_urls.get_character_response;
    const paneIndex = pane === "workspace" ? 0 : 1;
    const draft = pane === "workspace" ? workspaceDraft : coachDraft;
    const trimmedDraft = draft.trim();
    const uploads = uploadsByPane[pane];
    const sentAttachments = uploads.uploadedAttachments;

    if (
      !handlerUrl ||
      mode !== "chat" ||
      finished ||
      evaluationPending ||
      busyByPane[pane] ||
      uploads.uploading ||
      (!trimmedDraft && sentAttachments.length === 0)
    ) {
      return;
    }

    if (pane === "workspace" && attemptsRemaining !== null && attemptsRemaining <= 0) {
      return;
    }

    const userMessage: PendingCoachingMessage = {
      character: {
        avatar: "",
        name: "",
        pane,
        role: "user",
      },
      content: trimmedDraft,
      is_user: true,
      pane,
      attachments: sentAttachments,
      pending: true,
    };

    setHistories((currentHistories) => {
      return {
        ...currentHistories,
        [pane]: currentHistories[pane].concat(userMessage),
      };
    });

    if (pane === "workspace") {
      setWorkspaceDraft("");
    } else {
      setCoachDraft("");
    }
    uploads.clearAttachments();

    setErrorData(null);  // clear the error data while we try a new action
    setPaneBusy(pane, true);
    setPaneStatus(
      pane,
      intl.formatMessage({
        id: "coaching.student.sending",
        defaultMessage: "Sending message…",
      }),
    );

    try {
      const response = await sendChatMessage(
        handlerUrl,
        paneIndex,
        trimmedDraft,
        sentAttachments.map((attachment) => attachment.upload_id),
      );
      handleChatResponse(pane, response, trimmedDraft);
    } catch (error: any) {
      removePendingMessage(pane, trimmedDraft);
      setPaneBusy(pane, false);
      if (pane === "workspace") {
        setWorkspaceDraft(trimmedDraft);
      } else {
        setCoachDraft(trimmedDraft);
      }
      uploads.handleFailedSend(sentAttachments, error);
      const errorMessage = intl.formatMessage({
        id: "coaching.student.genericError",
        defaultMessage: "An error has occurred.",
      });
      setPaneStatus(pane, errorMessage);

      setErrorData({
        title: intl.formatMessage({
          id: "coaching.student.unableToSend",
          defaultMessage: "Unable to send message",
        }),
        message: error.toString(),
      });
    }
  }

  async function submitForEvaluation() {
    if (mode !== "chat" || finished || evaluationPending || busyByPane.workspace || workspaceUploads.uploading) {
      return;
    }

    setErrorData(null);  // clear the error data while we try a new action
    setEvaluationPending(true);
    setPaneBusy("workspace", true);
    setPaneStatus(
      "workspace",
      intl.formatMessage({
        id: "coaching.student.submitting",
        defaultMessage: "Submitting for evaluation…",
      }),
    );

    try {
      const response = await requestEvaluation(payload.handler_urls.get_evaluator_response);
      setEvaluationPending(false);
      setPaneBusy("workspace", false);
      applyResponseState(response);
      // The finished session deleted the files still waiting in either composer.
      workspaceUploads.clearAttachments();
      coachUploads.clearAttachments();
      const nextReport = toFinalReport(response);
      if (nextReport) {
        setReport(nextReport);
        setMode("report");
        setPaneStatus(
          "workspace",
          intl.formatMessage({
            id: "coaching.student.evaluationReady",
            defaultMessage: "Evaluation ready.",
          }),
        );
      }
    } catch (error: any) {
      setEvaluationPending(false);
      setPaneBusy("workspace", false);
      setPaneStatus(
        "workspace",
        intl.formatMessage({
          id: "coaching.student.submitErrorStatus",
          defaultMessage: "Unable to submit for evaluation.",
        }),
      );
      setErrorData({
        title: intl.formatMessage({
          id: "coaching.student.unableToSubmit",
          defaultMessage: "Unable to submit",
        }),
        message: error.toString(),
      });
    }
  }

  async function resetAllConversations() {
    if (resetDisabled) {
      return;
    }

    setErrorData(null);  // clear the error data while we try a new action
    setBusyByPane({
      coach: true,
      workspace: true,
    });
    setPaneStatus(
      "workspace",
      intl.formatMessage({
        id: "coaching.student.resetting",
        defaultMessage: "Resetting conversation…",
      }),
    );

    try {
      const response = await resetAll(payload.handler_urls.reset_all);
      const nextHistories = splitHistories(response.chat_histories);
      setHistories(nextHistories);
      setAttempts(response.attempts);
      setFinished(Boolean(response.finished));
      setMode("chat");
      setReport(null);
      setWorkspaceDraft("");
      setCoachDraft("");
      workspaceUploads.resetAttachments(response.remaining);
      coachUploads.resetAttachments(response.remaining);
      setBusyByPane({
        coach: false,
        workspace: false,
      });
      setPaneStatus(
        "workspace",
        intl.formatMessage({
          id: "coaching.student.resetDone",
          defaultMessage: "Conversation reset.",
        }),
      );
    } catch (error: any) {
      setBusyByPane({
        coach: false,
        workspace: false,
      });
      setPaneStatus(
        "workspace",
        intl.formatMessage({
          id: "coaching.student.resetErrorStatus",
          defaultMessage: "Unable to reset conversation.",
        }),
      );
      setErrorData({
        title: intl.formatMessage({
          id: "coaching.student.unableToReset",
          defaultMessage: "Unable to reset the workspace",
        }),
        message: error.toString(),
      });
    }
  }

  function renderAttemptsLabel() {
    if (!attempts.max_attempts) {
      return intl.formatMessage({
        id: "coaching.student.unlimitedResponses",
        defaultMessage: "Unlimited responses",
      });
    }

    const remainingCount =
      typeof attemptsRemaining === "number" ? Math.max(attemptsRemaining, 0) : 0;

    return intl.formatMessage(
      {
        id: "coaching.student.responsesRemaining",
        defaultMessage: "{count, plural, one {# response left} other {# responses left}}",
      },
      { count: remainingCount },
    );
  }

  return (
    <section
      className={"coach-block" + (reviewMode ? " coach-mode--review" : "")}
      data-block-kind="coaching"
      data-view={payload.view}
    >
      {meta.intro_text ? (
        <div className="coach-intro" dangerouslySetInnerHTML={{ __html: meta.intro_text }} />
      ) : null}

      <div className={"coach-layout" + (reportMode ? " coach-layout--report" : "")}>
        <section
          className={
            "coach-pane coach-pane--workspace" + (reportMode ? " coach-pane--report" : "")
          }
          aria-label={intl.formatMessage({
            id: "coaching.student.workspaceLabel",
            defaultMessage: "Learner workspace",
          })}
        >
          <header className="coach-pane__header">
            <h2 className="coach-pane__title coach-pane__title--workspace">
              {titles.workspace ||
                intl.formatMessage({
                  id: "coaching.student.workspaceTitle",
                  defaultMessage: "Add your answer",
                })}
            </h2>
          </header>

          <div
            className="coach-history"
            ref={workspaceHistoryRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-atomic="false"
            aria-busy={busyByPane.workspace ? "true" : undefined}
          >
            <div className="coach-messages" data-pane="workspace">
              {displayedWorkspaceMessages.map((message, index) => {
                return (
                  <ChatMessage
                    key={"workspace-" + String(index) + "-" + String(message.content || "")}
                    message={message}
                  />
                );
              })}
            </div>
            {busyByPane.workspace && <TypingIndicator />}
          </div>

          <div className="sr-only coach-status coach-status--workspace" role="status" aria-live="polite">
            {statusByPane.workspace}
          </div>

          <div
            className={
              "coach-input" +
              (workspaceInputVisible ? "" : " coach-input--hidden") +
              (workspaceUploads.enabled ? " coach-input--with-uploads" : "")
            }
          >
            <label htmlFor="coach-workspace-input" className="sr-only">
              {intl.formatMessage({
                id: "coaching.student.workspacePlaceholder",
                defaultMessage: "Start typing your answer",
              })}
            </label>
            <AttachmentUploader
              uploads={workspaceUploads}
              disabled={!workspaceInputVisible || busyByPane.workspace || evaluationPending}
            >
              <textarea
                id="coach-workspace-input"
                ref={workspaceTextareaRef}
                className="coach-input__textarea"
                disabled={!workspaceInputVisible || busyByPane.workspace || evaluationPending}
                maxLength={1000}
                placeholder={intl.formatMessage({
                  id: "coaching.student.workspacePlaceholder",
                  defaultMessage: "Start typing your answer",
                })}
                rows={1}
                value={workspaceDraft}
                onChange={(event) => {
                  setWorkspaceDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage("workspace");
                  }
                }}
              />
            </AttachmentUploader>
            <button
              type="button"
              className="coach-button coach-button--icon coach-send-button"
              aria-label={intl.formatMessage({
                id: "coaching.student.sendMessage",
                defaultMessage: "Send message",
              })}
              data-character-index="0"
              disabled={
                !workspaceInputVisible ||
                busyByPane.workspace ||
                evaluationPending ||
                workspaceUploads.uploading ||
                (!workspaceDraft.trim() && workspaceUploads.uploadedAttachments.length === 0)
              }
              onClick={() => {
                sendMessage("workspace");
              }}
            >
              <Icon src={PlayCircleFilled} className="coach-send-icon" />
            </button>
          </div>

          {reportMode && report ? (
            <ReportCard
              evaluationHtml={evaluationHtml}
              onReviewConversation={() => {
                setMode("review");
                setPaneStatus(
                  "workspace",
                  intl.formatMessage({
                    id: "coaching.student.reviewingConversation",
                    defaultMessage: "Reviewing conversation.",
                  }),
                );
              }}
              report={report}
            />
          ) : null}

        </section>

        {!reportMode ? <aside
          className="coach-pane coach-pane--coach"
          aria-label={intl.formatMessage({
            id: "coaching.student.coachLabel",
            defaultMessage: "Coach conversation",
          })}
        >
          <header className="coach-pane__header">
            <h2 className="coach-pane__title coach-pane__title--coach">
              {titles.coach ||
                intl.formatMessage({
                  id: "coaching.student.coachTitle",
                  defaultMessage: "Coach",
                })}
            </h2>
          </header>

          <div
            className="coach-history"
            ref={coachHistoryRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-atomic="false"
            aria-busy={busyByPane.coach ? "true" : undefined}
          >
            <div className="coach-messages" data-pane="coach">
              {displayedCoachMessages.map((message, index) => {
                return (
                  <ChatMessage
                    key={"coach-" + String(index) + "-" + String(message.content || "")}
                    message={message}
                  />
                );
              })}
            </div>
            {busyByPane.coach && <TypingIndicator />}
          </div>

          <div className="sr-only coach-status coach-status--coach" role="status" aria-live="polite">
            {statusByPane.coach}
          </div>

          <div
            className={
              "coach-input" +
              (coachInputVisible ? "" : " coach-input--hidden") +
              (coachUploads.enabled ? " coach-input--with-uploads" : "")
            }
          >
            <label htmlFor="coach-side-input" className="sr-only">
              {intl.formatMessage({
                id: "coaching.student.coachPlaceholder",
                defaultMessage: "Start typing...",
              })}
            </label>
            <AttachmentUploader
              uploads={coachUploads}
              disabled={!coachInputVisible || busyByPane.coach || evaluationPending}
              stacked
            >
              <textarea
                id="coach-side-input"
                ref={coachTextareaRef}
                className="coach-input__textarea"
                disabled={!coachInputVisible || busyByPane.coach || evaluationPending}
                maxLength={1000}
                placeholder={intl.formatMessage({
                  id: "coaching.student.coachPlaceholder",
                  defaultMessage: "Start typing...",
                })}
                rows={1}
                value={coachDraft}
                onChange={(event) => {
                  setCoachDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage("coach");
                  }
                }}
              />
            </AttachmentUploader>
            <button
              type="button"
              className="coach-button coach-button--icon coach-send-button"
              aria-label={intl.formatMessage({
                id: "coaching.student.sendCoachMessage",
                defaultMessage: "Send message to coach",
              })}
              data-character-index="1"
              disabled={
                !coachInputVisible ||
                busyByPane.coach ||
                evaluationPending ||
                coachUploads.uploading ||
                (!coachDraft.trim() && coachUploads.uploadedAttachments.length === 0)
              }
              onClick={() => {
                sendMessage("coach");
              }}
            >
              <Icon src={PlayCircleFilled} className="coach-send-icon" />
            </button>
          </div>
        </aside> : null}
      </div>

      <div className="coach-actions">
        {allowReset && !reviewMode ? (
          <button
            type="button"
            className="coach-button coach-button--secondary coach-reset-all"
            disabled={resetDisabled}
            onClick={() => setConfirmType("reset")}
            ref={setResetConfirmTarget}
          >
            {intl.formatMessage({
              id: "coaching.student.reset",
              defaultMessage: "Start again",
            })}
          </button>
        ) : null}
        {!reviewMode && !reportMode ? (
          <div className="coach-attempts">
            <span
              className={
                "coach-attempts__label" +
                (attemptsRemaining === 1 ? " coach-attempts__label--warning" : "")
              }
              aria-live="polite"
            >
              {renderAttemptsLabel()}
            </span>
          </div>
        ) : null}
        {reviewMode && report ? (
          <button
            type="button"
            className="coach-button coach-button--secondary coach-back-to-report"
            ref={backToReportRef}
            onClick={() => {
              setMode("report");
              setPaneStatus(
                "workspace",
                intl.formatMessage({
                  id: "coaching.student.reportShown",
                  defaultMessage: "Evaluation report shown.",
                }),
              );
            }}
          >
            {intl.formatMessage({
              id: "coaching.student.backToReport",
              defaultMessage: "Back to report",
            })}
          </button>
        ) : null}
        {!reviewMode && !reportMode ? (
          <button
            type="button"
            className="coach-button coach-button--primary coach-submit-evaluation"
            disabled={!canSubmitForEvaluation}
            onClick={() => setConfirmType("submit")}
            ref={setSubmitConfirmTarget}
          >
            {intl.formatMessage({
              id: "coaching.student.submitForEvaluation",
              defaultMessage: "Submit for evaluation",
            })}
          </button>
        ) : null}
      </div>

      {(reportMode || reviewMode) && payload.meta.pdf_download_allowed && <DownloadPDFSection pdfUrl={payload.handler_urls.download_pdf} title={payload.meta.pdf_download_title} description={payload.meta.pdf_download_description} />}

      <ConfirmResetModal
        positionRef={resetConfirmTarget}
        isOpen={confirmType == "reset"}
        onConfirm={() => {
          setConfirmType(null);
          resetAllConversations();
        }}
        onCancel={() => setConfirmType(null)}
      />

      <SubmitConfirmDialog
        positionRef={submitConfirmTarget}
        isOpen={confirmType == "submit"}
        uploadsEnabled={workspaceUploads.enabled}
        remainingResponses={attemptsRemaining === null ? intl.formatMessage({ id: "coaching.student.submitConfirm.unlimited", defaultMessage: "unlimited", }) : attemptsRemaining}
        onConfirm={() => {
          setConfirmType(null);
          submitForEvaluation();
        }}
        onCancel={() => setConfirmType(null)}
      />

      {errorData &&
        <GenericErrorAlert
          error={errorData}
          onClose={() => setErrorData(null)}
        />
      }

      <PoweredByAI />
    </section>
  );
}

interface SubmitConfirmDialogProps {
  remainingResponses: string | number;
  /** Whether the learner can attach files in the workspace; the evaluator then also gets their latest files. */
  uploadsEnabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isOpen: boolean;
  positionRef: HTMLElement | null;
}

const SubmitConfirmDialog = ({
  remainingResponses,
  uploadsEnabled,
  onConfirm,
  onCancel,
  isOpen,
  positionRef,
}: SubmitConfirmDialogProps) => {
  const intl = useIntl();
  const labelId = useId();

  if (!isOpen) {
    return null;
  }

  return (
    // This wrapper div ensures that you can't accidentally interact with the rest of the block while the popup is open.
    // Ideally this wouldn't be necessary, but the isBlocking behaviour of ModalPopup is buggy.
    <div className="modal-background">
      <ModalPopup
        hasArrow
        positionRef={positionRef}
        isOpen={isOpen}
        // XXX: I couldn't use the built-in onClose functionality, because it's too sensitive.
        // The onClose was triggered even when clicking the confirm button.
        onClose={() => {}}
        placement="top"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          className="bg-white p-3 rounded shadow border"
        >
          <h3 id={labelId}>{intl.formatMessage({
            id: "coaching.student.submitConfirm.title",
            defaultMessage: "Submit your work?",
          })}</h3>
          <p>
          { intl.formatMessage(
            uploadsEnabled
              ? {
                id: "coaching.student.submitConfirm.bodyWithUploads",
                defaultMessage:
                  "You still have {count} responses left. If you submit now, your latest answer and your most recently sent file(s) will be evaluated.",
              }
              : {
                id: "coaching.student.submitConfirm.body",
                defaultMessage:
                  "You still have {count} responses left. If you submit now, your current response will be scored.",
              },
            { count: remainingResponses, },
          )}
          </p>

          <ActionRow>
            <ModalCloseButton onClick={onCancel} variant="tertiary">
              {intl.formatMessage({
                id: "coaching.student.submitConfirm.cancel",
                defaultMessage: "Cancel",
              })}
            </ModalCloseButton>
            <Button onClick={onConfirm}>
              {intl.formatMessage({
                id: "coaching.student.submitConfirm.confirm",
                defaultMessage: "Submit for evaluation",
              })}
            </Button>
          </ActionRow>
        </div>
      </ModalPopup>
    </div>
  );
};
