function ChatBoxMulti(runtime, element, data, handleChatboxInit,
                      handleResponse, handleReset) {
  "use strict";

  loadMarkedInIframe(data.marked_html);

  const handlerUrl = runtime.handlerUrl(element, "get_character_response");
  const resetHandlerUrl = runtime.handlerUrl(element, "reset");

  const enableControl = function($control, enable) {
    $control.prop("disabled", !enable);
    $control[enable ? "removeClass" : "addClass"]("disabled");
  };

  $(".chat-user-input", element).on("input", function(event) {
    const $input = $(this);
    $input.height(0);
    $input.height($input.prop("scrollHeight"));
  });

  const $resetButton = $(".chat-reset-button", element);
  const $finishButton = $(".chat-finish-button", element);
  const $submitButtons = $(".chat-submit-button", element);
  const $userInputs = $(".chat-user-input", element);
  const $spinnerContainers = $(".chat-spinner-container", element);

  function setupChatbox($chatbox, chatboxIndex) {
    const $chatContainer = $(".chat-history", $chatbox);
    const $spinner = $(".message-spinner", $chatbox);
    const $spinnerContainer = $(".chat-spinner-container", $chatbox);
    const $submitButton = $(".chat-submit-button", $chatbox);
    const $userInput = $(".chat-user-input", $chatbox);

    const scrollToBottom = function() {
      $chatContainer.scrollTop($chatContainer.prop("scrollHeight"));
    };

    const insertMessage = function(class_, content) {
      const $message = $('<div class="chat-message">');
      $message.addClass(class_);
      $message.append(content);
      const $messageContainer = $('<div class="chat-message-container">');
      $messageContainer.append($message);
      $messageContainer.insertBefore($spinnerContainer);
      scrollToBottom();
    };

    const deleteLastMessage = function() {
      $spinnerContainer.prev().remove();
    };

    const fns = {
      chatboxIndex: chatboxIndex,

      enableReset: function(enable) {
        const enabled = !$resetButton.prop("disabled");
        enableControl($resetButton, enable);
        return enabled;
      },

      enableInput: function(enable) {
        const enabled = !$userInput.prop("disabled");
        enableControl($userInputs, enable);
        enableControl($submitButtons, enable);
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
        error: function() {
          $spinner.hide();
          fns.enableReset(resetEnabled);
          fns.enableInput(inputEnabled);
          if (inputData.user_input) {
            deleteLastMessage();
            $userInput.val(inputData.user_input);
            $userInput.trigger("input");
          }
          alert(gettext("An error has occurred."));
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
      getResponse({
        user_input: $input.val(),
        character_index: chatboxIndex,
      });
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
          $spinnerContainers.prevAll('.chat-message-container').remove();
          fns.enableInput(true);
          handleReset.call(fns);
        },
        error: function() {
          $spinner.hide();
          fns.enableReset(resetEnabled);
          fns.enableInput(inputEnabled);
          alert(gettext("An error has occurred."));
        },
      });
    });

    var initDone = false;

    const init = function() {
      if (initDone) {
        return;
      }
      initDone = true;
      handleChatboxInit.call(fns);
    };

    runFuncAfterLoading(init);
  }

  for (var i = 0; i < data.characters.length; i++) {
    const $chatbox = $(`#chat-chatbox-${i}`, element);
    setupChatbox($chatbox, i);
  }
}
