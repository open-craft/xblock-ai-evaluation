function ChatBox(runtime, element, data, handleInit, handleResponse,
                 handleReset) {
  "use strict";

  loadMarkedInIframe(data.marked_html);

  const handlerUrl = runtime.handlerUrl(element, "get_response");
  const resetHandlerUrl = runtime.handlerUrl(element, "reset");

  const $chatbox = $("#chatbox", element);
  const $chatContainer = $(".chat-history", $chatbox);
  const $spinner = $(".message-spinner", $chatbox);
  const $spinnerContainer = $(".chat-spinner-container", $chatbox);
  const $resetButton = $(".chat-reset-button", $chatbox);
  const $finishButton = $(".chat-finish-button", $chatbox);
  const $submitButton = $(".chat-submit-button", $chatbox);
  const $userInput = $(".chat-user-input", $chatbox);
  const $status = $(".chat-status", $chatbox);
  const $characterImage = $(".shortanswer_image img", element);
  const $question = $(".question-text", element);

  const updateChatMinHeight = function() {
    if (!$characterImage.length) {
      $chatContainer.css("min-height", "");
      return;
    }
    const imageHeight = $characterImage.height();
    if (!imageHeight) {
      $chatContainer.css("min-height", "");
      return;
    }
    const questionHeight = $question.outerHeight(true) || 0;
    const minHeight = imageHeight - questionHeight;
    if (minHeight > 0) {
      $chatContainer.css("min-height", minHeight);
    } else {
      $chatContainer.css("min-height", "");
    }
  };

  if ($characterImage.length) {
    updateChatMinHeight();
    if (!$characterImage[0].complete) {
      $characterImage.on("load", updateChatMinHeight);
      $characterImage.on("error", updateChatMinHeight);
    }
    $(window).on("resize", updateChatMinHeight);
  }

  const announceStatus = function(message) {
    if ($status.length) {
      $status.text(message || "");
    }
  };

  const setBusy = function(isBusy) {
    if (isBusy) {
      $chatContainer.attr("aria-busy", "true");
    } else {
      $chatContainer.removeAttr("aria-busy");
    }
  };

  const enableControl = function($control, enable) {
    if (!$control.length) {
      return;
    }
    $control.prop("disabled", !enable);
    $control.attr("aria-disabled", !enable);
    $control[enable ? "removeClass" : "addClass"]("disabled");
  };

  $userInput.on("input", function(event) {
    const $input = $(this);
    $input.height(0);
    $input.height($input.prop("scrollHeight"));
  });

  const scrollToBottom = function() {
    $chatContainer.scrollTop($chatContainer.prop("scrollHeight"));
  };

  const scrollToNewMessage = function($messageContainer) {
    $chatContainer.scrollTop($messageContainer[0].offsetTop);
  };

  const insertMessage = function(class_, content) {
    const $message = $('<div class="chat-message">');
    $message.addClass(class_);
    $message.append(content);
    const $messageContainer = $('<div class="chat-message-container">');
    $messageContainer.append($message);
    $messageContainer.insertBefore($spinnerContainer);
    scrollToNewMessage($messageContainer);
  };

  const deleteLastMessage = function() {
    $spinnerContainer.prev().remove();
  };

  const fns = {
    enableReset: function(enable) {
      const enabled = !$resetButton.prop("disabled");
      enableControl($resetButton, enable);
      return enabled;
    },

    enableInput: function(enable) {
      const enabled = !$userInput.prop("disabled");
      enableControl($userInput, enable);
      enableControl($submitButton, enable);
      enableControl($finishButton, enable);
      return enabled;
    },

    focusInput: function() {
      $userInput.trigger("focus");
    },

    announce: function(message) {
      announceStatus(message);
    },

    insertUserMessage: function(content) {
      if (content) {
        insertMessage("user-answer", $(MarkdownToHTML(content)));
      }
    },

    insertAIMessage: function(content) {
      insertMessage("ai-eval", content);
    },
  };

  const getResponse = function(inputData) {
    const inputEnabled = fns.enableInput(false);
    const resetEnabled = fns.enableReset(false);
    if (inputData.user_input) {
      fns.insertUserMessage(inputData.user_input);
      $userInput.val("");
      $userInput.trigger("input");
    }
    $spinner.show();
    scrollToBottom();
    setBusy(true);
    announceStatus(gettext("Sending message..."));
    $.ajax({
      url: handlerUrl,
      method: "POST",
      data: JSON.stringify(inputData),
      success: function(response) {
        $spinner.hide();
        setBusy(false);
        fns.enableReset(true);
        handleResponse.call(fns, response);
        announceStatus(gettext("Assistant response ready."));
        if (inputEnabled) {
          fns.focusInput();
        }
      },
      error: function(xhr) {
        $spinner.hide();
        setBusy(false);
        fns.enableReset(resetEnabled);
        fns.enableInput(inputEnabled);
        if (inputData.user_input) {
          deleteLastMessage();
          $userInput.val(inputData.user_input);
          $userInput.trigger("input");
        }
        announceStatus(gettext("Unable to process your message. Please try again."));
        try {
          const response = JSON.parse(xhr.responseText);
          alert(response.error || gettext("An error has occurred."));
        } catch (e) {
          alert(gettext("An error has occurred."));
        }
      },
    });
  };

  const handleUserInput = function($input) {
    if ($input.prop("disabled")) {
      return;
    }
    if (!$input.val()) {
      return;
    }
    getResponse({ user_input: $input.val() });
  };

  $userInput.on("keydown", function(event) {
    const isEnter = event.key ? event.key === "Enter" : event.keyCode === 13;
    if (isEnter && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleUserInput($(this));
    }
  });

  $submitButton.click(function() {
    if ($(this).prop("disabled")) {
      return;
    }
    handleUserInput($userInput);
  });

  $finishButton.click(function() {
    if ($(this).prop("disabled")) {
      return;
    }
    getResponse({ force_finish: true });
  });

  $resetButton.click(function() {
    if ($(this).prop("disabled")) {
      return;
    }
    const inputEnabled = fns.enableInput(false);
    const resetEnabled = fns.enableReset(false);
    $spinner.show();
    scrollToBottom();
    setBusy(true);
    announceStatus(gettext("Resetting chat..."));
    $.ajax({
      url: resetHandlerUrl,
      method: "POST",
      data: JSON.stringify({}),
      success: function() {
        $spinner.hide();
        setBusy(false);
        $spinnerContainer.prevAll('.chat-message-container').remove();
        fns.enableInput(true);
        handleReset.call(fns);
        announceStatus(gettext("Chat reset. Start typing a new response."));
        fns.focusInput();
      },
      error: function(xhr) {
        $spinner.hide();
        setBusy(false);
        fns.enableReset(resetEnabled);
        fns.enableInput(inputEnabled);
        announceStatus(gettext("Unable to reset the chat. Please try again."));
        try {
          const response = JSON.parse(xhr.responseText);
          alert(response.error || gettext("An error has occurred."));
        } catch (e) {
          alert(gettext("An error has occurred."));
        }
      },
    });
  });

  var initDone = false;

  const init = function() {
    if (initDone) {
      return;
    }
    initDone = true;
    handleInit.call(fns);
    updateChatMinHeight();
  };

  runFuncAfterLoading(init);
}
