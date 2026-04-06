import React, { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";

import { postJson } from "../shared/request";
import { ensureMarkdownRenderer, renderMarkdown } from "../shared/renderMarkdown";
import { UnknownRecord } from "../shared/types";
import {
  CoachingAttemptState,
  CoachingCharacter,
  CoachingFinalReport,
  CoachingMessage,
  CoachingStudentPayload,
} from "./types";

type PaneKey = "workspace" | "coach";
type CoachMode = "chat" | "report" | "review";

interface PendingCoachingMessage extends CoachingMessage {
  pending?: boolean;
}

interface CharacterResponse extends UnknownRecord {
  attempts?: unknown;
  finished?: boolean;
  message?: unknown;
  report_html?: string;
  evaluation_markdown?: string;
  final_submission?: string;
}

function normalizeCharacter(character: unknown, fallbackPane: PaneKey): CoachingCharacter {
  if (!character || typeof character !== "object") {
    return {
      avatar: "",
      name: "",
      pane: fallbackPane,
      role: "",
    };
  }

  const rawCharacter = character as CoachingCharacter;
  const pane = rawCharacter.pane === "coach" ? "coach" : fallbackPane;

  return {
    avatar: typeof rawCharacter.avatar === "string" ? rawCharacter.avatar : "",
    name: typeof rawCharacter.name === "string" ? rawCharacter.name : "",
    pane,
    role: typeof rawCharacter.role === "string" ? rawCharacter.role : "",
  };
}

function normalizeMessage(message: unknown, fallbackPane: PaneKey): PendingCoachingMessage {
  if (!message || typeof message !== "object") {
    return {
      character: normalizeCharacter({}, fallbackPane),
      content: "",
      is_user: false,
      pane: fallbackPane,
    };
  }

  const rawMessage = message as CoachingMessage;
  const pane = rawMessage.pane === "coach" ? "coach" : fallbackPane;

  return {
    character: normalizeCharacter(rawMessage.character, pane),
    content: typeof rawMessage.content === "string" ? rawMessage.content : "",
    is_user: Boolean(rawMessage.is_user),
    pane,
  };
}

function normalizeHistory(messages: unknown, fallbackPane: PaneKey): PendingCoachingMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => normalizeMessage(message, fallbackPane));
}

function normalizeHistories(chatHistories: unknown) {
  if (!Array.isArray(chatHistories)) {
    return {
      coach: [] as PendingCoachingMessage[],
      workspace: [] as PendingCoachingMessage[],
    };
  }

  return {
    workspace: normalizeHistory(chatHistories[0], "workspace"),
    coach: normalizeHistory(chatHistories[1], "coach"),
  };
}

function normalizeAttempts(attempts: unknown): CoachingAttemptState {
  if (!attempts || typeof attempts !== "object") {
    return {
      attempts_remaining: null,
      attempts_used: 0,
      can_retry: true,
      max_attempts: 0,
    };
  }

  const rawAttempts = attempts as CoachingAttemptState;
  const attemptsRemaining =
    typeof rawAttempts.attempts_remaining === "number"
      ? rawAttempts.attempts_remaining
      : rawAttempts.attempts_remaining === null
        ? null
        : null;

  return {
    attempts_remaining: attemptsRemaining,
    attempts_used:
      typeof rawAttempts.attempts_used === "number" ? rawAttempts.attempts_used : 0,
    can_retry:
      typeof rawAttempts.can_retry === "boolean" ? rawAttempts.can_retry : true,
    max_attempts:
      typeof rawAttempts.max_attempts === "number" ? rawAttempts.max_attempts : 0,
  };
}

function normalizeFinalReport(report: unknown): CoachingFinalReport | null {
  if (!report || typeof report !== "object") {
    return null;
  }

  const rawReport = report as CoachingFinalReport;
  if (typeof rawReport.report_html !== "string" || !rawReport.report_html) {
    return null;
  }

  return {
    attempts: normalizeAttempts(rawReport.attempts),
    evaluation_markdown:
      typeof rawReport.evaluation_markdown === "string" ? rawReport.evaluation_markdown : "",
    final_submission:
      typeof rawReport.final_submission === "string" ? rawReport.final_submission : "",
    finished: Boolean(rawReport.finished),
    report_html: rawReport.report_html,
    show_report_card: Boolean(rawReport.show_report_card),
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

function ChatMessage({ message }: { message: PendingCoachingMessage }) {
  const pane = message.pane === "coach" ? "coach" : "workspace";
  const isUser = Boolean(message.is_user);
  const character = normalizeCharacter(message.character, pane);
  const className = `coach-message coach-message--pane-${pane} ${isUser ? "coach-message--user" : "coach-message--ai"}${message.pending ? " coach-message--pending" : ""}`;

  return (
    <div className={className}>
      {!isUser ? <MessageAvatar character={character} /> : null}
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
    </div>
  );
}

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    container.innerHTML = report.report_html || "";
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

  return <div ref={containerRef} />;
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
    return normalizeHistories(payload.initial_state.chat_histories);
  }, [payload.initial_state.chat_histories]);
  const initialAttempts = useMemo(() => {
    return normalizeAttempts(payload.initial_state.attempts);
  }, [payload.initial_state.attempts]);
  const initialFinalReport = useMemo(() => {
    return normalizeFinalReport(payload.initial_state.final_report);
  }, [payload.initial_state.final_report]);
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
  const [statusByPane, setStatusByPane] = useState({
    coach: "",
    workspace: "",
  });
  const [markdownReady, setMarkdownReady] = useState(false);
  const workspaceHistoryRef = useRef<HTMLDivElement>(null);
  const coachHistoryRef = useRef<HTMLDivElement>(null);
  const workspaceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const coachTextareaRef = useRef<HTMLTextAreaElement>(null);
  const backToReportRef = useRef<HTMLButtonElement>(null);
  const meta = payload.meta || {};
  const titles = meta.titles || {};
  const allowReset = Boolean(meta.allow_reset);
  const initialWorkspaceMessage =
    meta.initial_message &&
    typeof meta.initial_message.content === "string" &&
    meta.initial_message.content
      ? normalizeMessage(meta.initial_message, "workspace")
      : null;
  const initialCoachMessage =
    meta.coach_initial_message &&
    typeof meta.coach_initial_message.content === "string" &&
    meta.coach_initial_message.content
      ? normalizeMessage(meta.coach_initial_message, "coach")
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
    !evaluationPending;
  const reviewMode = mode === "review";
  const reportMode = mode === "report";

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
    let active = true;

    ensureMarkdownRenderer(meta.marked_html).then(() => {
      if (active) {
        setMarkdownReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, [meta.marked_html]);

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
  }, [displayedWorkspaceMessages, markdownReady, mode, busyByPane.workspace]);

  useEffect(() => {
    const history = coachHistoryRef.current;
    if (history) {
      history.scrollTop = history.scrollHeight;
    }
  }, [displayedCoachMessages, markdownReady, mode, busyByPane.coach]);

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

  function appendMessage(pane: PaneKey, message: unknown) {
    const normalizedMessage = normalizeMessage(message, pane);
    setHistories((currentHistories) => {
      return {
        ...currentHistories,
        [pane]: currentHistories[pane].concat(normalizedMessage),
      };
    });
  }

  function showGenericError(pane: PaneKey) {
    const errorMessage = intl.formatMessage({
      id: "coaching.student.genericError",
      defaultMessage: "An error has occurred.",
    });

    setPaneStatus(pane, errorMessage);
    window.alert(errorMessage);
  }

  function applyResponseState(response: CharacterResponse) {
    if (response.attempts) {
      setAttempts(normalizeAttempts(response.attempts));
    }

    if (typeof response.finished !== "undefined") {
      setFinished(Boolean(response.finished));
    }
  }

  function handleChatResponse(pane: PaneKey, response: CharacterResponse, userInput: string) {
    updateMessagePendingState(pane, userInput, false);
    setPaneBusy(pane, false);
    applyResponseState(response);

    if (typeof response.report_html === "string" && response.report_html) {
      const nextReport = normalizeFinalReport(response);
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
      const normalizedMessage = normalizeMessage(response.message, pane);
      appendMessage(pane, normalizedMessage);
      setPaneStatus(
        pane,
        normalizedMessage.character?.name
          ? intl.formatMessage(
              {
                id: "coaching.student.newMessageFromName",
                defaultMessage: "New message from {name}",
              },
              { name: normalizedMessage.character?.name || "" },
            )
          : intl.formatMessage({
              id: "coaching.student.newMessage",
              defaultMessage: "New message received",
            }),
      );
    }
  }

  function sendMessage(pane: PaneKey) {
    const handlerUrl = payload.handler_urls.get_character_response;
    const paneIndex = pane === "workspace" ? 0 : 1;
    const draft = pane === "workspace" ? workspaceDraft : coachDraft;
    const trimmedDraft = draft.trim();

    if (
      !handlerUrl ||
      mode !== "chat" ||
      finished ||
      evaluationPending ||
      busyByPane[pane] ||
      !trimmedDraft
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

    setPaneBusy(pane, true);
    setPaneStatus(
      pane,
      intl.formatMessage({
        id: "coaching.student.sending",
        defaultMessage: "Sending message…",
      }),
    );

    postJson<CharacterResponse>(handlerUrl, {
      character_index: paneIndex,
      user_input: trimmedDraft,
    })
      .then((response) => {
        handleChatResponse(pane, response, trimmedDraft);
      })
      .catch(() => {
        removePendingMessage(pane, trimmedDraft);
        setPaneBusy(pane, false);
        if (pane === "workspace") {
          setWorkspaceDraft(trimmedDraft);
        } else {
          setCoachDraft(trimmedDraft);
        }
        showGenericError(pane);
      });
  }

  function submitForEvaluation() {
    const handlerUrl = payload.handler_urls.get_evaluator_response;

    if (!handlerUrl || mode !== "chat" || finished || evaluationPending || busyByPane.workspace) {
      return;
    }

    setEvaluationPending(true);
    setPaneBusy("workspace", true);
    setPaneStatus(
      "workspace",
      intl.formatMessage({
        id: "coaching.student.submitting",
        defaultMessage: "Submitting for evaluation…",
      }),
    );

    postJson<CharacterResponse>(handlerUrl, {})
      .then((response) => {
        setEvaluationPending(false);
        setPaneBusy("workspace", false);
        applyResponseState(response);
        const nextReport = normalizeFinalReport(response);
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
      })
      .catch(() => {
        setEvaluationPending(false);
        setPaneBusy("workspace", false);
        setPaneStatus(
          "workspace",
          intl.formatMessage({
            id: "coaching.student.submitErrorStatus",
            defaultMessage: "Unable to submit for evaluation.",
          }),
        );
        window.alert(
          intl.formatMessage({
            id: "coaching.student.genericError",
            defaultMessage: "An error has occurred.",
          }),
        );
      });
  }

  function resetAllConversations() {
    const handlerUrl = payload.handler_urls.reset_all;

    if (!handlerUrl || busyByPane.workspace || busyByPane.coach) {
      return;
    }

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

    postJson<CharacterResponse>(handlerUrl, {})
      .then((response) => {
        const nextHistories = normalizeHistories(response.chat_histories);
        setHistories(nextHistories);
        setAttempts(normalizeAttempts(response.attempts));
        setFinished(Boolean(response.finished));
        setMode("chat");
        setReport(null);
        setWorkspaceDraft("");
        setCoachDraft("");
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
      })
      .catch(() => {
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
        window.alert(
          intl.formatMessage({
            id: "coaching.student.genericError",
            defaultMessage: "An error has occurred.",
          }),
        );
      });
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
      data-markdown-ready={markdownReady ? "true" : "false"}
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
            {busyByPane.workspace ? (
              <div className="coach-spinner" aria-hidden="true" style={{ display: "block" }}>
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </div>

          <div className="sr-only coach-status coach-status--workspace" role="status" aria-live="polite">
            {statusByPane.workspace}
          </div>

          <div className={"coach-input" + (workspaceInputVisible ? "" : " coach-input--hidden")}>
            <label htmlFor="coach-workspace-input" className="sr-only">
              {intl.formatMessage({
                id: "coaching.student.workspacePlaceholder",
                defaultMessage: "Start typing your answer",
              })}
            </label>
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
                !workspaceDraft.trim()
              }
              onClick={() => {
                sendMessage("workspace");
              }}
            >
              <i className="fa fa-paper-plane" aria-hidden="true" />
            </button>
          </div>

          <div className="coach-actions">
            {!reviewMode ? (
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
            {!reviewMode ? (
              <button
                type="button"
                className="coach-button coach-button--primary coach-submit-evaluation"
                disabled={!canSubmitForEvaluation}
                onClick={submitForEvaluation}
              >
                {intl.formatMessage({
                  id: "coaching.student.submitForEvaluation",
                  defaultMessage: "Submit for evaluation",
                })}
              </button>
            ) : null}
          </div>

          {reportMode && report ? (
            <ReportCard
              evaluationHtml={renderMarkdown(report.evaluation_markdown)}
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

        <aside
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
            {busyByPane.coach ? (
              <div className="coach-spinner" aria-hidden="true" style={{ display: "block" }}>
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </div>

          <div className="sr-only coach-status coach-status--coach" role="status" aria-live="polite">
            {statusByPane.coach}
          </div>

          <div className={"coach-input" + (coachInputVisible ? "" : " coach-input--hidden")}>
            <label htmlFor="coach-side-input" className="sr-only">
              {intl.formatMessage({
                id: "coaching.student.coachPlaceholder",
                defaultMessage: "Ask the coach a question",
              })}
            </label>
            <textarea
              id="coach-side-input"
              ref={coachTextareaRef}
              className="coach-input__textarea"
              disabled={!coachInputVisible || busyByPane.coach || evaluationPending}
              maxLength={1000}
              placeholder={intl.formatMessage({
                id: "coaching.student.coachPlaceholder",
                defaultMessage: "Ask the coach a question",
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
            <button
              type="button"
              className="coach-button coach-button--icon coach-send-button"
              aria-label={intl.formatMessage({
                id: "coaching.student.sendCoachMessage",
                defaultMessage: "Send message to coach",
              })}
              data-character-index="1"
              disabled={
                !coachInputVisible || busyByPane.coach || evaluationPending || !coachDraft.trim()
              }
              onClick={() => {
                sendMessage("coach");
              }}
            >
              <i className="fa fa-paper-plane" aria-hidden="true" />
            </button>
          </div>
        </aside>
      </div>

      {allowReset && !reviewMode ? (
        <div className="coach-global-actions">
          <button
            type="button"
            className="coach-button coach-button--secondary coach-reset-all"
            disabled={busyByPane.workspace || busyByPane.coach}
            onClick={resetAllConversations}
          >
            {intl.formatMessage({
              id: "coaching.student.reset",
              defaultMessage: "Reset",
            })}
          </button>
        </div>
      ) : null}
    </section>
  );
}
