/* Coach XBlock redesigned frontend. */
function CoachAIEvalXBlock(runtime, element, data) {
  "use strict";

  loadMarkedInIframe(data.marked_html);

  const handlerUrl = runtime.handlerUrl(element, "get_character_response");
  const resetHandlerUrl = runtime.handlerUrl(element, "reset");
  const resumeAttemptHandlerUrl = runtime.handlerUrl(element, "resume_attempt");
  const evaluatorHandlerUrl = runtime.handlerUrl(element, "get_evaluator_response");

  const translate = (typeof gettext === "function") ? gettext : (message) => message;
  const translatePlural = (typeof ngettext === "function")
    ? ngettext
    : (singular, plural, count) => (count === 1 ? singular : plural);

  const $element = $(element);
  const $sendButtons = $(".coach-send-button", element);
  const $inputs = $(".coach-input__textarea", element);
  const $tryAgainButton = $(".coach-try-again", element);
  const $submitEvaluation = $(".coach-submit-evaluation", element);
  const $resetButton = $(".coach-reset-button", element);
  const $attemptLabel = $(".coach-attempts__label", element);

  const state = {
    finished: Boolean(data.finished),
    attempts: data.attempts || {},
    allowReset: data.allow_reset,
    characters: data.characters || [],
  };

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

  const paneFromIndex = function(index) {
    return paneControllers[index] ? paneControllers[index].pane : "workspace";
  };

  const getCharacterForIndex = function(index) {
    return state.characters ? state.characters[index] : null;
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
      if (character.role && character.role.toLowerCase() !== "user") {
        $meta.append($('<span class="coach-message__role">').text(character.role));
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
    const $workspaceInput = $(".coach-input[data-character-index='0']", element);
    if ($workspaceInput.length) {
      if (show) {
        $workspaceInput.removeClass("coach-input--hidden");
      } else {
        $workspaceInput.addClass("coach-input--hidden");
      }
    }
  };

  const setEvaluationEnabled = function(enable) {
    if ($submitEvaluation.length) {
      $submitEvaluation.prop("disabled", !enable);
      $submitEvaluation.toggleClass("disabled", !enable);
    }
  };

  const setTryAgainEnabled = function(enable) {
    if ($tryAgainButton.length) {
      $tryAgainButton.prop("disabled", !enable);
      $tryAgainButton.toggleClass("disabled", !enable);
    }
  };

  const setResetEnabled = function(enable) {
    if ($resetButton.length) {
      $resetButton.prop("disabled", !enable);
      $resetButton.toggleClass("disabled", !enable);
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

    const inputOpen = attempts.input_open !== undefined ? Boolean(attempts.input_open) : true;
    const canRetry = attempts.can_retry && !inputOpen;
    setTryAgainEnabled(Boolean(canRetry));
    const canReset = attempts.can_retry || !inputOpen;
    setResetEnabled(Boolean(canReset));

    const attemptsRemaining = typeof attempts.attempts_remaining === "number"
      ? attempts.attempts_remaining
      : null;
    const showInput = !state.finished && inputOpen && (attemptsRemaining === null || attemptsRemaining > 0);
    toggleInputsForWorkspace(showInput);

    setEvaluationEnabled(!state.finished);
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
      const messages = histories && histories[controller.index] ? histories[controller.index] : [];
      messages.forEach((message) => appendMessage(controller, message));
    });
  };

  const handleResponse = function(controller, response, userElement) {
    if (userElement) {
      userElement.removeClass("coach-message--pending");
    }
    setPaneBusy(controller, false);
    setInputEnabled(controller, true);
    if (response && response.message) {
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

  const startNewAttempt = function() {
    const attempts = state.attempts || {};
    const inputOpen = attempts.input_open !== undefined ? Boolean(attempts.input_open) : true;
    if (inputOpen) {
      return;
    }
    if (attempts.max_attempts && attempts.attempts_remaining === 0) {
      return;
    }
    setAllInputsEnabled(false);
    if (paneControllers[0]) {
      setPaneBusy(paneControllers[0], true);
    }
    announceStatus("workspace", translate("Preparing a new attempt…"));
    $.ajax({
      url: resumeAttemptHandlerUrl,
      method: "POST",
      data: JSON.stringify({}),
      success: function(response) {
        state.finished = Boolean(response && response.finished);
        if (response && response.attempts) {
          state.attempts = response.attempts;
        }
        setAllInputsEnabled(true);
        if (paneControllers[0]) {
          setPaneBusy(paneControllers[0], false);
        }
        updateAttemptUI();
        announceStatus("workspace", translate("You can try again now."));
      },
      error: function() {
        setAllInputsEnabled(true);
        if (paneControllers[0]) {
          setPaneBusy(paneControllers[0], false);
        }
        updateAttemptUI();
        announceStatus("workspace", translate("Unable to start a new attempt."));
        alert(translate("An error has occurred."));
      },
    });
  };

  const resetCoachPane = function() {
    if (!state.allowReset || !$resetButton.length) {
      return;
    }
    setAllInputsEnabled(false);
    if (paneControllers[0]) {
      setPaneBusy(paneControllers[0], true);
    }
    if (paneControllers[1]) {
      setPaneBusy(paneControllers[1], true);
    }
    announceStatus("workspace", translate("Resetting conversation…"));

    $.ajax({
      url: resetHandlerUrl,
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
        if (paneControllers[0]) {
          setPaneBusy(paneControllers[0], false);
        }
        if (paneControllers[1]) {
          setPaneBusy(paneControllers[1], false);
        }
        state.finished = Boolean(response && response.finished);
        setAllInputsEnabled(true);
        updateAttemptUI();
      },
      error: function() {
        if (paneControllers[0]) {
          setPaneBusy(paneControllers[0], false);
        }
        if (paneControllers[1]) {
          setPaneBusy(paneControllers[1], false);
        }
        setAllInputsEnabled(true);
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

  if ($tryAgainButton.length) {
    $tryAgainButton.on("click", function() {
      startNewAttempt();
    });
  }

  if ($resetButton.length) {
    $resetButton.on("click", function() {
      resetCoachPane();
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
  });
}
