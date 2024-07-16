/* Javascript for CodingAIEvalXBlock. */
function CodingAIEvalXBlock(runtime, element, data) {
  const runCodeHandlerURL = runtime.handlerUrl(element, "submit_code_handler");
  const submissionResultURL = runtime.handlerUrl(
    element,
    "get_submission_result_handler",
  );
  loadMarkedInIframe();
  const llmResponseHandlerURL = runtime.handlerUrl(element, "get_response");

  const iframe = $("#monaco", element)[0]; //document.getElementById("monaco");
  const submitButton = $("#submit-button", element);
  const resetButton = $("#reset-button", element);
  const AIFeeback = $("#ai-feedback", element);
  const stdout = $(".stdout", element);
  const stderr = $(".stderr", element);

  $(function () {
    // The newer runtime uses the 'data-usage' attribute, while the LMS uses 'data-usage-id'
    // A Jquery can sometimes (e.g. after studio field edit) be returned, we handle it with ?.[0]
    const xblockUsageId =
      element.getAttribute?.("data-usage") ||
      element.getAttribute?.("data-usage-id") ||
      element?.[0].getAttribute("data-usage-id");

    if (!xblockUsageId) {
      throw new Error(
        "XBlock is missing a usage ID attribute on its root HTML node.",
      );
    }

    // __USAGE_ID_PLACEHOLDER__ is the event data sent from the monaco iframe after loading
    // we rely on the usage_id to limit the event to the Xblock scope
    iframe.srcdoc = data.srcdoc.replace(
      "__USAGE_ID_PLACEHOLDER__",
      xblockUsageId,
    );
    runFuncAfterLoading(init);
    function submitCode() {
      const code = iframe.contentWindow.editor.getValue();
      return $.ajax({
        url: runCodeHandlerURL,
        method: "POST",
        data: JSON.stringify({ user_code: code }),
      });
    }
    function delay(ms, data) {
      const deferred = $.Deferred();
      setTimeout(function () {
        deferred.resolve(data);
      }, ms);
      return deferred.promise();
    }
    function getSubmissionResult(data) {
      console.log("getSubmissionResult", data);
      return $.ajax({
        url: submissionResultURL,
        method: "POST",
        data: JSON.stringify({ submission_id: data.submission_id }),
        success: function (data) {
          const output = [data.compile_output, data.stdout].join("\n").trim();
          stdout.text(output);
          stderr.text(data.stderr);
        },
      });
    }

    function getLLMFeedback(data) {
      return $.ajax({
        url: llmResponseHandlerURL,
        method: "POST",
        data: JSON.stringify({
          code: iframe.contentWindow.editor.getValue(),
          stdout: data.stdout,
          stderr: data.stderr,
        }),
        success: function (data) {
          console.log(data);
          AIFeeback.html(MarkdownToHTML(data.response));
          $("#ai-feedback-tab", element).click();
        },
      });
    }

    resetButton.click(() => {
      iframe.contentWindow.editor.setValue("");
    });

    submitButton.click(() => {
      disableSubmitButton();
      submitCode()
        .then(function (data) {
          return delay(2500, data);
        })
        .then(getSubmissionResult)
        .then(getLLMFeedback)
        .done(function (data) {
          enableSubmitButton();
        })
        .fail(function (data) {
          console.log("fail", data);
          enableSubmitButton();
          alert("A problem occured while trying to execute the code.");
        });
    });

    function init() {
      $("#question-text", element).html(MarkdownToHTML(data.question));

      const monacoIframeDoc =
        iframe.contentDocument || iframe.contentWindow.document;
      window.addEventListener("message", function (event) {
        if (event.data === xblockUsageId) {
          if (data.code?.length) {
            iframe.contentWindow.editor.setValue(data.code);
          }

          AIFeeback.html(MarkdownToHTML(data.ai_evaluation || ""));
          stdout.text(data.code_exec_result?.stdout || "");
          stderr.text(data.code_exec_result?.stderr || "");
        }
      });
    }
  });

  function disableSubmitButton() {
    submitButton.append('<i class="fa fa-spinner fa-spin submit-loader"></i>');
    submitButton.prop("disabled", true);
    submitButton.addClass("disabled-btn");
  }

  function enableSubmitButton() {
    $(".submit-loader", element).remove();
    submitButton.prop("disabled", false);
    submitButton.removeClass("disabled-btn");
  }

  // basic tabs
  $(".tablinks", element).click((event) => {
    $(".tabcontent", element).hide();
    $(".tablinks", element).removeClass("active");
    $(event.target).addClass("active");
    const contentID = "#" + $(event.target).data("id");
    $(contentID, element).show();
  });
  // default tab
  $("#defaultOpen", element).click();
}
