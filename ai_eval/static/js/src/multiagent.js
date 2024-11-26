/* Javascript for MultiAgentAIEvalXBlock. */
function MultiAgentAIEvalXBlock(runtime, element, data) {
  const handlerUrl = runtime.handlerUrl(element, "get_response");
  const resetHandlerUrl = runtime.handlerUrl(element, "reset");

  loadMarkedInIframe(data.marked_html);

  $(function () {
    const spinner = $(".message-spinner", element);
    const spinnnerContainer = $("#chat-spinner-container", element);
    const resetButton = $("#reset-button", element);
    const finishButton = $("#finish-button", element);
    const submitButton = $("#submit-button", element);
    const userInput = $(".user-input", element);
    const userInputElem = userInput[0];
    let initDone = false;

    var getResponse = function(data) {
      disableInput();
      spinner.show();
      $.ajax({
        url: handlerUrl,
        method: "POST",
        data: JSON.stringify(data),
        success: function (response) {
          spinner.hide();
          insertAIMessage(response.role, response.character_name, response.message);
          if (data.user_input?.length) {
            userInput.val("");
          }
          if (response.finished) {
            disableInput();
          } else {
            enableInput();
          }
        },
        error: function (jqXHR, textStatus, errorThrown) {
          spinner.hide();
          alert(errorThrown);
          if (data.user_input?.length) {
            deleteLastMessage();
          }
          enableInput();
        },
      });
    }

    submitButton.click(() => {
      if (!userInput.val().length) {
        return;
      }
      insertUserMessage(userInput.val());
      getResponse({ user_input: userInput.val() });
    });

    finishButton.click(() => {
      getResponse({ force_finish: true });
    });

    resetButton.click(() => {
      if (!resetButton.hasClass("disabled-btn")) {
        $.ajax({
          url: resetHandlerUrl,
          method: "POST",
          data: JSON.stringify({}),
          success: function () {
            spinnnerContainer.prevAll('.chat-message-container').remove();
            insertAIMessage("", "", data.initial_message);
            resetButton.addClass("disabled-btn");
            enableInput();
          },
          error: function(xhr, status, error) {
            console.error('Error:', error);
            alert("A problem occured during reset.");
          }
        });
      }
    });

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
      if (initDone) return;
      initDone = true;
      insertAIMessage("", "", data.initial_message);
      for (let i = 0; i < data.messages.USER.length; i++) {
        insertUserMessage(data.messages.USER[i]);
        insertAIMessage(data.agents[i].role, data.agents[i].character_name, data.messages.LLM[i]);
        resetButton.removeClass("disabled-btn");
      }
      if (data.finished) {
        disableInput();
      }
    }

    var insertUserMessage = function(msg) {
      if (msg?.length) {
        $(`<div class="chat-message-container">
          <div class="chat-message user-answer">${MarkdownToHTML(msg)}</div>
        </div>`).insertBefore(spinnnerContainer);
        resetButton.removeClass("disabled-btn");
      }
    }

    var insertAIMessage = function(role, name, msg) {
      if (role == "FINISH") {
        name = `${gettext("Evaluator")}:`
      } else {
        if (role) {
          name = name + ` <i>(${role})</i>`;
        }
        if (name) {
          name = name + ":"
        }
      }
      $(`<div class="chat-message-container">
        <div class="chat-message ai-eval">
          <b>${name}</b>
          ${MarkdownToHTML(msg)}
        </div>
      </div>`).insertBefore(spinnnerContainer);
      resetButton.removeClass("disabled-btn");
    }

    var deleteLastMessage = function() {
      spinnnerContainer.prev().remove();
    }

    runFuncAfterLoading(init);
  });
}
