/* Coach XBlock redesigned frontend. */
function CoachAIEvalXBlock(runtime, element, data) {
  "use strict";

  loadMarkedInIframe(data.marked_html);

  const handlerUrl = runtime.handlerUrl(element, "get_character_response");
  const resetAllHandlerUrl = runtime.handlerUrl(element, "reset_all");
  const evaluatorHandlerUrl = runtime.handlerUrl(element, "get_evaluator_response");

  const translate = (typeof gettext === "function") ? gettext : (message) => message;
  const translatePlural = (typeof ngettext === "function")
    ? ngettext
    : (singular, plural, count) => (count === 1 ? singular : plural);

  const $sendButtons = $(".coach-send-button", element);
  const $inputs = $(".coach-input__textarea", element);
  const $submitEvaluation = $(".coach-submit-evaluation", element);
  const $resetAllButton = $(".coach-reset-all", element);
  const $attemptLabel = $(".coach-attempts__label", element);

  const state = {
    finished: Boolean(data.finished),
    attempts: data.attempts || {},
    characters: data.characters || [],
  };

  const $layout = $(".coach-layout", element);
  const $workspacePane = $(".coach-pane--workspace", element);
  const $workspaceHistory = $(".coach-history[data-character-index='0']", $workspacePane);
  const $workspaceInputWrapper = $(".coach-input[data-character-index='0']", $workspacePane);
  const $workspaceActions = $(".coach-actions", $workspacePane);
  let $reportCard = null;

  const paneControllers = {};
  $(".coach-history", element).each(function() {
    const $history = $(this);
    const index = parseInt($history.data("character-index"), 10);
    const pane = $(".coach-messages", this).data("pane");
    paneControllers[index] = {
      index,
      pane,
      $history,
      $messages: $(".coach-messages", this),
      $spinner: $(".coach-spinner", this),
      busy: false,
    };
    paneControllers[index].$spinner.hide();
  });

  const statusByPane = {
    workspace: $(".coach-status--workspace", element),
    coach: $(".coach-status--coach", element),
  };

  const sanitizeHTML = function(content) {
    return stripScriptTags(MarkdownToHTML(content || ""));
  };

  const initialsForName = function(name) {
    if (!name) {
      return "";
    }
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((part) => part.charAt(0)).join("").toUpperCase();
  };

  const createAvatarElement = function(character) {
    const $avatar = $('<div class="coach-message__avatar">');
    if (character && character.avatar) {
      const avatarAlt = character && character.name
        ? translate("Avatar for %(name)s").replace("%(name)s", character.name)
        : translate("Avatar");
      const $img = $("<img>", {
        src: character.avatar,
        alt: avatarAlt,
      });
      $avatar.append($img);
    } else if (character && character.name) {
      $avatar.append($("<span>").text(initialsForName(character.name)));
      $avatar.attr("aria-hidden", "true");
    } else {
      $avatar.addClass("coach-message__avatar--empty");
      $avatar.attr("aria-hidden", "true");
    }
    return $avatar;
  };

  const buildMessageElement = function(message) {
    const pane = message.pane || (message.character ? message.character.pane : "workspace");
    const isUser = Boolean(message.is_user);
    const character = message.character || {};

    const $message = $('<div class="coach-message">');
    $message.addClass(`coach-message--pane-${pane}`);
    if (isUser) {
      $message.addClass("coach-message--user");
    } else {
      $message.addClass("coach-message--ai");
    }

    const $contentWrapper = $('<div class="coach-message__bubble">');

    if (!isUser) {
      $message.append(createAvatarElement(character));
      const $meta = $('<div class="coach-message__meta">');
      if (character.name) {
        $meta.append($('<span class="coach-message__name">').text(character.name));
      }
      $contentWrapper.append($meta);
    }

    const $content = $('<div class="coach-message__content">').html(sanitizeHTML(message.content));
    $contentWrapper.append($content);

    $message.append($contentWrapper);
    return $message;
  };

  const scrollToBottom = function(controller) {
    const history = controller.$history.get(0);
    if (history) {
      history.scrollTop = history.scrollHeight;
    }
  };

  const appendMessage = function(controller, message) {
    const $message = buildMessageElement(message);
    controller.$messages.append($message);
    scrollToBottom(controller);
  };

  const insertUserMessage = function(controller, content) {
    const message = {
      content,
      is_user: true,
      pane: controller.pane,
      character: {
        name: "",
        role: "user",
        pane: controller.pane,
      },
    };
    const $element = buildMessageElement(message);
    controller.$messages.append($element);
    scrollToBottom(controller);
    return $element;
  };

  const announceStatus = function(pane, text) {
    const $status = statusByPane[pane];
    if ($status && $status.length) {
      $status.text(text || "");
    }
  };

  const setPaneBusy = function(controller, busy) {
    controller.busy = busy;
    controller.$spinner.toggle(busy);
    if (busy) {
      controller.$history.attr("aria-busy", "true");
    } else {
      controller.$history.removeAttr("aria-busy");
    }
  };

  const setInputEnabled = function(controller, enable) {
    const selector = `.coach-input__textarea[data-character-index="${controller.index}"]`;
    const $textarea = $(selector, element);
    $textarea.prop("disabled", !enable);
    const $button = $sendButtons.filter(`[data-character-index="${controller.index}"]`);
    $button.prop("disabled", !enable);
    if (!enable) {
      $button.addClass("disabled");
    } else {
      $button.removeClass("disabled");
    }
  };

  const setAllInputsEnabled = function(enable) {
    Object.keys(paneControllers).forEach((key) => {
      setInputEnabled(paneControllers[key], enable);
    });
  };

  const toggleInputsForWorkspace = function(show) {
    if ($workspaceInputWrapper.length) {
      if (show) {
        $workspaceInputWrapper.removeClass("coach-input--hidden");
        $workspaceInputWrapper.show();
      } else {
        $workspaceInputWrapper.addClass("coach-input--hidden");
        $workspaceInputWrapper.hide();
      }
    }
  };

  const showReportCard = function(response) {
    if ($reportCard) {
      $reportCard.remove();
    }
    $reportCard = $(response.report_html || "");
    if ($reportCard.length) {
      const evaluationMarkdown = response.evaluation_markdown || "";
      if (evaluationMarkdown) {
        const evaluationHTML = sanitizeHTML(evaluationMarkdown);
        $reportCard.find(".coach-report-card__evaluation").html(evaluationHTML);
      }
      if ($workspaceHistory.length) {
        $workspaceHistory.hide();
      }
      toggleInputsForWorkspace(false);
      if ($workspaceActions.length) {
        $workspaceActions.hide();
      }
      if ($workspacePane.length) {
        $workspacePane.addClass("coach-pane--report");
      }
      if ($layout.length) {
        $layout.addClass("coach-layout--report");
      }

      $reportCard.find(".coach-report-card__actions").remove();

      $workspacePane.append($reportCard);
      setEvaluationEnabled(false);
    }
  };

  const hideReportCard = function() {
    if ($reportCard) {
      $reportCard.remove();
      $reportCard = null;
    }
    if ($workspaceHistory.length) {
      $workspaceHistory.show();
    }
    if ($workspaceActions.length) {
      $workspaceActions.show();
    }
    if ($workspacePane.length) {
      $workspacePane.removeClass("coach-pane--report");
    }
    if ($layout.length) {
      $layout.removeClass("coach-layout--report");
    }
  };

  const setEvaluationEnabled = function(enable) {
    if ($submitEvaluation.length) {
      $submitEvaluation.prop("disabled", !enable);
      $submitEvaluation.toggleClass("disabled", !enable);
    }
  };

  const updateAttemptUI = function() {
    const attempts = state.attempts || {};
    let label = "";
    let warning = false;
    if (attempts.max_attempts) {
      const remaining = typeof attempts.attempts_remaining === "number"
        ? Math.max(attempts.attempts_remaining, 0)
        : 0;
      warning = remaining === 1;
      label = translatePlural("%(count)s attempt left", "%(count)s attempts left", remaining)
        .replace("%(count)s", remaining);
    } else {
      label = translate("Unlimited attempts");
    }

    if ($attemptLabel.length) {
      $attemptLabel.text(label);
      $attemptLabel.toggleClass("coach-attempts__label--warning", warning);
    }

    const hasMaxAttempts = attempts.max_attempts && attempts.max_attempts > 0;

    const attemptsRemaining = typeof attempts.attempts_remaining === "number"
      ? attempts.attempts_remaining
      : null;
    const showInput = (attemptsRemaining === null || attemptsRemaining > 0) && !state.finished;
    toggleInputsForWorkspace(showInput);
    if (paneControllers[0]) {
      setInputEnabled(paneControllers[0], showInput);
    }
    const hasSubmission = (attempts.attempts_used || 0) > 0;
    setEvaluationEnabled(hasSubmission && !state.finished);
  };

  const applyFinishedState = function(finished) {
    state.finished = finished;
    if (finished) {
      setAllInputsEnabled(false);
    } else {
      setAllInputsEnabled(true);
    }
    updateAttemptUI();
  };

  const populateHistories = function(histories) {
    Object.keys(paneControllers).forEach((key) => {
      const controller = paneControllers[key];
      controller.$messages.empty();
      if (controller.index === 0 && data.initial_message && data.initial_message.content) {
        appendMessage(controller, data.initial_message);
      }
      if (controller.index === 1 && data.coach_initial_message && data.coach_initial_message.content) {
        appendMessage(controller, data.coach_initial_message);
      }
      const messages = histories && histories[controller.index] ? histories[controller.index] : [];
      messages.forEach((message) => appendMessage(controller, message));
    });
  };

  const handleResponse = function(controller, response, userElement) {
    const hasReport = Boolean(response && response.report_html);
    if (userElement) {
      userElement.removeClass("coach-message--pending");
    }
    setPaneBusy(controller, false);
    if (!hasReport) {
      setInputEnabled(controller, true);
    }

    if (hasReport) {
      showReportCard(response);
      announceStatus(controller.pane, translate("Evaluation ready."));
    }

    if (response && response.message && !hasReport) {
      appendMessage(controller, response.message);
      const name = response.message.character ? response.message.character.name : "";
      const announcement = name
        ? translate("New message from %(name)s").replace("%(name)s", name)
        : translate("New message received");
      announceStatus(controller.pane, announcement);
    }

    if (response && response.attempts) {
      state.attempts = response.attempts;
    }
    if (typeof response.finished !== "undefined") {
      applyFinishedState(Boolean(response.finished));
    } else {
      updateAttemptUI();
    }
  };

  const handleError = function(controller, userElement, originalInput, enableInputs) {
    if (userElement) {
      userElement.remove();
    }
    setPaneBusy(controller, false);
    if (enableInputs) {
      setInputEnabled(controller, true);
    }
    if (originalInput !== null && typeof originalInput !== "undefined") {
      const $textarea = $inputs.filter(`[data-character-index="${controller.index}"]`);
      $textarea.val(originalInput);
      autoResize($textarea);
    }
    announceStatus(controller.pane, translate("An error has occurred."));
    alert(translate("An error has occurred."));
  };

  const autoResize = function($input) {
    $input.height(0);
    $input.height($input.get(0).scrollHeight);
  };

  const sendMessage = function(index) {
    const controller = paneControllers[index];
    if (!controller || controller.busy) {
      return;
    }
    if (state.finished) {
      return;
    }
    if (index === 0) {
      const attempts = state.attempts || {};
      const remaining = typeof attempts.attempts_remaining === "number"
        ? attempts.attempts_remaining
        : null;
      if (remaining !== null && remaining <= 0) {
        return;
      }
    }

    const $textarea = $inputs.filter(`[data-character-index="${index}"]`);
    const content = ($textarea.val() || "").trim();
    if (!content) {
      return;
    }

    const originalInput = $textarea.val();
    const userMessageEl = insertUserMessage(controller, content);
    userMessageEl.addClass("coach-message--pending");
    $textarea.val("");
    autoResize($textarea);

    setPaneBusy(controller, true);
    setInputEnabled(controller, false);
    announceStatus(controller.pane, translate("Sending message…"));

    $.ajax({
      url: handlerUrl,
      method: "POST",
      data: JSON.stringify({
        user_input: content,
        character_index: index,
      }),
      success: function(response) {
        handleResponse(controller, response, userMessageEl);
      },
      error: function() {
        handleError(controller, userMessageEl, originalInput, true);
      },
    });
  };

  const resetAllConversations = function() {
    if ($resetAllButton.length === 0) {
      return;
    }
    if (Object.values(paneControllers).some((controller) => controller.busy)) {
      return;
    }
    setAllInputsEnabled(false);
    Object.values(paneControllers).forEach((controller) => setPaneBusy(controller, true));
    announceStatus("workspace", translate("Resetting conversation…"));

    $.ajax({
      url: resetAllHandlerUrl,
      method: "POST",
      data: JSON.stringify({}),
      success: function(response) {
        if (response && response.chat_histories) {
          populateHistories(response.chat_histories);
        } else {
          populateHistories([[], []]);
        }
        if (response && response.attempts) {
          state.attempts = response.attempts;
        }
        state.finished = Boolean(response && response.finished);
        hideReportCard();
        setAllInputsEnabled(true);
        Object.values(paneControllers).forEach((controller) => setPaneBusy(controller, false));
        updateAttemptUI();
        announceStatus("workspace", translate("Conversation reset."));
      },
      error: function() {
        setAllInputsEnabled(true);
        Object.values(paneControllers).forEach((controller) => setPaneBusy(controller, false));
        updateAttemptUI();
        announceStatus("workspace", translate("Unable to reset conversation."));
        alert(translate("An error has occurred."));
      },
    });
  };

  const submitForEvaluation = function() {
    if (state.finished) {
      return;
    }
    if (paneControllers[0]) {
      setPaneBusy(paneControllers[0], true);
    }
    setAllInputsEnabled(false);
    announceStatus("workspace", translate("Submitting for evaluation…"));
    setEvaluationEnabled(false);

    $.ajax({
      url: evaluatorHandlerUrl,
      method: "POST",
      data: JSON.stringify({}),
      success: function(response) {
        if (paneControllers[0]) {
          handleResponse(paneControllers[0], response, null);
          setPaneBusy(paneControllers[0], false);
        }
      },
      error: function() {
        if (paneControllers[0]) {
          setPaneBusy(paneControllers[0], false);
        }
        setAllInputsEnabled(true);
        updateAttemptUI();
        announceStatus("workspace", translate("Unable to submit for evaluation."));
        alert(translate("An error has occurred."));
      },
    });
  };

  $inputs.on("input", function() {
    autoResize($(this));
  });

  $inputs.on("keypress", function(event) {
    if (event.keyCode === 13 && !event.shiftKey) {
      event.preventDefault();
      const index = parseInt($(this).data("character-index"), 10);
      sendMessage(index);
      return false;
    }
    return true;
  });

  $sendButtons.on("click", function() {
    const index = parseInt($(this).data("character-index"), 10);
    sendMessage(index);
  });

  $inputs.each(function() {
    autoResize($(this));
  });

  if ($resetAllButton.length) {
    $resetAllButton.on("click", function() {
      resetAllConversations();
    });
  }

  if ($submitEvaluation.length) {
    $submitEvaluation.on("click", function() {
      submitForEvaluation();
    });
  }

  runFuncAfterLoading(function init() {
    populateHistories(data.chat_histories);
    applyFinishedState(state.finished);
    if (data.final_report && data.final_report.report_html) {
      if (data.final_report.attempts) {
        state.attempts = data.final_report.attempts;
      }
      showReportCard({
        report_html: data.final_report.report_html,
        evaluation_markdown: data.final_report.evaluation_markdown,
        final_submission: data.final_report.final_submission,
        attempts: state.attempts,
      });
    }
  });
}
