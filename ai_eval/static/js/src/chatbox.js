function ChatBox(runtime, element, data, handleInit, handleResponse,
                 handleReset) {
  "use strict";

  loadMarkedInIframe(data.marked_html);

  const handlerUrl = runtime.handlerUrl(element, "get_response");
  const resetHandlerUrl = runtime.handlerUrl(element, "reset");

  const $chatContainer = $("#chat-history", element);
  const $spinner = $("#message-spinner", element);
  const $spinnerContainer = $("#chat-spinner-container", element);
  const $resetButton = $("#reset-button", element);
  const $finishButton = $("#finish-button", element);
  const $submitButton = $("#submit-button", element);
  const $userInput = $("#user-input", element);

  const enableControl = function($control, enable) {
    $control.prop("disabled", !enable);
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
    $.ajax({
      url: handlerUrl,
      method: "POST",
      data: JSON.stringify(inputData),
      success: function(response) {
        $spinner.hide();
        fns.enableReset(true);
        handleResponse.call(fns, response);
      },
      error: function(xhr) {
        $spinner.hide();
        fns.enableReset(resetEnabled);
        fns.enableInput(inputEnabled);
        if (inputData.user_input) {
          deleteLastMessage();
          $userInput.val(inputData.user_input);
          $userInput.trigger("input");
        }
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

  $userInput.keypress(function(event) {
    if (event.keyCode == 13 && !event.shiftKey) {
      event.preventDefault();
      handleUserInput($(this));
      return false;
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
    $.ajax({
      url: resetHandlerUrl,
      method: "POST",
      data: JSON.stringify({}),
      success: function() {
        $spinner.hide();
        $spinnerContainer.prevAll('.chat-message-container').remove();
        fns.enableInput(true);
        handleReset.call(fns);
      },
      error: function(xhr) {
        $spinner.hide();
        fns.enableReset(resetEnabled);
        fns.enableInput(inputEnabled);
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
  };

  runFuncAfterLoading(init);
}
