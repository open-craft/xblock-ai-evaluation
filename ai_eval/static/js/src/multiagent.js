/* Javascript for MultiAgentAIEvalXBlock. */
function MultiAgentAIEvalXBlock(runtime, element, data) {
  const handlerUrl = runtime.handlerUrl(element, "get_response");
  const resetHandlerURL = runtime.handlerUrl(element, "reset");

  loadMarkedInIframe(data.marked_html);

  $(function () {
    const spinner = $(".message-spinner", element);
    const spinnnerContainer = $("#chat-spinner-container", element);
    const resetButton = $("#reset-button", element);
    const submitButton = $("#submit-button", element);
    const userInput = $(".user-input", element);
    const userInputElem = userInput[0];
    let initDone = false;

    runFuncAfterLoading(init);

    function getResponse() {
      if (!userInput.val().length) return;

      disableInput();
      spinner.show();
      insertUserMessage(userInput.val());
      $.ajax({
        url: handlerUrl,
        method: "POST",
        data: JSON.stringify({ user_input: userInput.val() }),
        success: function (response) {
          spinner.hide();
          insertAIMessage(response.role, response.character_name, response.message);
          userInput.val("");
          if (response.finished) {
            disableInput();
          } else {
            enableInput();
          }
        },
        error: function (jqXHR, textStatus, errorThrown) {
          spinner.hide();
          alert(errorThrown);

          deleteLastMessage();
          enableInput();
        },
      });
    }

    submitButton.click(getResponse);

    resetButton.click(() => {
      if (!resetButton.hasClass("disabled-btn")) {
        $.ajax({
          url: resetHandlerURL,
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

    function disableInput() {
      userInput.prop("disabled", true);
      userInput.removeAttr("placeholder");
      submitButton.prop("disabled", true);
      submitButton.addClass("disabled-btn");
    }

    function enableInput() {
      userInput.prop("disabled", false);
      submitButton.prop("disabled", false);
      submitButton.removeClass("disabled-btn");
    }

    function adjustTextareaHeight(element) {
      element.style.height = "";
      element.style.height = element.scrollHeight + "px";
    }
    userInputElem.addEventListener("input", (event) => {
      adjustTextareaHeight(userInputElem);
    });

    function init() {
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

    function insertUserMessage(msg) {
      if (msg?.length) {
        $(` <div class="chat-message-container">
                <div class="chat-message user-answer">${MarkdownToHTML(msg)}</div>
      </div>`).insertBefore(spinnnerContainer);
        resetButton.removeClass("disabled-btn");
      }
    }

    function insertAIMessage(role, name, msg) {
      if (role == "FINISH") {
        name = "Evaluator:"
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

    function deleteLastMessage() {
      spinnnerContainer.prev().remove();
    }
  });
}
