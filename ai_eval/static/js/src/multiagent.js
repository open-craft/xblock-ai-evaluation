/* Javascript for MultiAgentAIEvalXBlock. */
function MultiAgentAIEvalXBlock(runtime, element, data) {
  const handlerUrl = runtime.handlerUrl(element, "get_response");
  const resetHandlerUrl = runtime.handlerUrl(element, "reset");

  loadMarkedInIframe(data.marked_html);

  $(function () {
    const chatContainer = $(".chat-history", element);
    const spinner = $(".message-spinner", element);
    const spinnerContainer = $("#chat-spinner-container", element);
    const resetButton = $("#reset-button", element);
    const finishButton = $("#finish-button", element);
    const submitButton = $("#submit-button", element);
    const userInput = $(".user-input", element);
    const userInputElem = userInput[0];
    let initDone = false;

    var getResponse = function(data) {
      disableInput();
      disableReset();
      spinner.show();
      $.ajax({
        url: handlerUrl,
        method: "POST",
        data: JSON.stringify(data),
        success: function(response) {
          spinner.hide();
          if (data.user_input?.length) {
            insertUserMessage(data.user_input);
            userInput.val("");
          }
          insertAIMessage(response.message, response.is_evaluator,
                          response.role, response.character_data);
          enableReset();
          if (!response.finished) {
            enableInput();
          }
        },
        error: function(jqXHR, textStatus, errorThrown) {
          spinner.hide();
          alert("An error has occurred.");
          if (data.user_input?.length) {
            deleteLastMessage();
          }
          enableReset();
          enableInput();
        },
      });
    }

    submitButton.click(() => {
      if (submitButton.hasClass("disabled-btn")) {
        return;
      }
      if (!userInput.val().length) {
        return;
      }
      getResponse({ user_input: userInput.val() });
    });

    finishButton.click(() => {
      if (finishButton.hasClass("disabled-btn")) {
        return;
      }
      getResponse({ force_finish: true });
    });

    resetButton.click(() => {
      if (resetButton.hasClass("disabled-btn")) {
        return;
      }
      disableReset();
      $.ajax({
        url: resetHandlerUrl,
        method: "POST",
        data: JSON.stringify({}),
        success: function() {
          spinnerContainer.prevAll('.chat-message-container').remove();
          insertInitialMessage();
          enableInput();
        },
        error: function(xhr, status, error) {
          console.error('Error:', error);
          alert("A problem occurred during reset.");
          enableReset();
        }
      });
    });

    var disableReset = function() {
      resetButton.prop("disabled", true);
      resetButton.addClass("disabled-btn");
    }

    var enableReset = function() {
      resetButton.prop("disabled", false);
      resetButton.removeClass("disabled-btn");
    }

    var disableInput = function() {
      userInput.prop("disabled", true);
      userInput.removeAttr("placeholder");
      submitButton.prop("disabled", true);
      submitButton.addClass("disabled-btn");
      finishButton.prop("disabled", true);
      finishButton.addClass("disabled-btn");
    }

    var enableInput = function() {
      userInput.prop("disabled", false);
      submitButton.prop("disabled", false);
      submitButton.removeClass("disabled-btn");
      finishButton.prop("disabled", false);
      finishButton.removeClass("disabled-btn");
    }

    var adjustTextareaHeight = function(element) {
      element.style.height = "";
      element.style.height = element.scrollHeight + "px";
    }
    userInputElem.addEventListener("input", (event) => {
      adjustTextareaHeight(userInputElem);
    });

    var init = function() {
      if (initDone) {
        return;
      }
      initDone = true;
      insertInitialMessage();
      disableReset();
      for (let i = 0; i < data.messages.length; i++) {
        let message = data.messages[i];
        if (message.role === "user") {
          insertUserMessage(message.content);
        } else {
          insertAIMessage(message.content, message.extra.is_evaluator,
                          message.extra.role, message.extra.character_data);
        }
        enableReset();
      }
      if (data.finished) {
        disableInput();
      }
      scrollToBottom();
    }

    var insertInitialMessage = function() {
      insertAIMessage(data.initial_message, false, data.main_character_role,
                      data.main_character_data);
    }

    var insertUserMessage = function(content) {
      if (content?.length) {
        $(`<div class="chat-message-container">
          <div class="chat-message user-answer">${MarkdownToHTML(content)}</div>
        </div>`).insertBefore(spinnerContainer);
        scrollToBottom();
      }
    }

    var insertAIMessage = function(content, is_evaluator, role, character_data) {
      var name = "";
      if (is_evaluator) {
        name = gettext("Evaluator");
      } else {
        if (character_data) {
          name = character_data.name;
          var role_text = "";
          if (role !== data.main_character_role) {
            role_text = `<i>${role}</i>`;
          }
          if (character_data.role) {
            if (role_text.length !== 0) {
              role_text = `${role_text}, `;
            }
            role_text = `${role_text}${character_data.role}`;
          }
          if (role_text.length !== 0) {
            name = name + ` (${role_text})`;
          }
        }
      }
      if (name) {
        name = `${name}:`;
      }
      $(`<div class="chat-message-container">
        <div class="chat-message ai-eval">
          <b>${name}</b>
          ${MarkdownToHTML(content)}
        </div>
      </div>`).insertBefore(spinnerContainer);
      scrollToBottom();
    }

    var deleteLastMessage = function() {
      spinnerContainer.prev().remove();
    }

    var scrollToBottom = function() {
      chatContainer.scrollTop(chatContainer.prop("scrollHeight"));
    }

    runFuncAfterLoading(init);
  });
}
