/* Javascript for ShortAnswerAIEvalXBlock. */
function ShortAnswerAIEvalXBlock(runtime, element, data) {
  const handlerUrl = runtime.handlerUrl(element, "get_response");

  loadMarkedInIframe();

  $(function () {
    const answer = $(".user-answer", element);

    const evaluation = $(".ai-eval", element);
    const spinner = $(".message-spinner", element);
    const spinnnerContainer = $("#chat-spinner-container", element);
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
          if($(".user-answer", element).length >= data.max_responses){
            disableInput();
          }
          else{
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
      }
      if(data.messages.USER.length && data.messages.USER.length >= data.max_responses){
        disableInput();
      }
    }

    function insertUserMessage(msg) {
      if (msg?.length) {
        $(` <div class="chat-message-container">
                <div class="chat-message user-answer">${MarkdownToHTML(msg)}</div>
      </div>`).insertBefore(spinnnerContainer);
      }
    }

    function insertAIMessage(msg) {
      if (msg?.length) {
        $(` <div class="chat-message-container">
                <div class="chat-message ai-eval">${MarkdownToHTML(msg)}</div>
      </div>`).insertBefore(spinnnerContainer);
      }
    }
    function deleteLastMessage() {
      spinnnerContainer.prev().remove();
    }
  });
}
