/* Javascript for ShortAnswerAIEvalXBlock. */
function ShortAnswerAIEvalXBlock(runtime, element, data) {
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
          insertAIMessage(response.response);
          userInput.val("");
          if ($(".user-answer", element).length >= data.max_responses) {
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
          success: function (data) {
            spinnnerContainer.prevAll('.chat-message-container').remove();
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
      $("#question-text", element).html(MarkdownToHTML(data.question));
      for (let i = 0; i < data.messages.USER.length; i++) {
        insertUserMessage(data.messages.USER[i]);
        insertAIMessage(data.messages.LLM[i]);
        resetButton.removeClass("disabled-btn");
      }
      if (
        data.messages.USER.length &&
        data.messages.USER.length >= data.max_responses
      ) {
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

    function insertAIMessage(msg) {
      if (msg?.length) {
        $(` <div class="chat-message-container">
                <div class="chat-message ai-eval">${MarkdownToHTML(msg)}</div>
      </div>`).insertBefore(spinnnerContainer);
        resetButton.removeClass("disabled-btn");
      }
    }
    function deleteLastMessage() {
      spinnnerContainer.prev().remove();
    }
  });
}
