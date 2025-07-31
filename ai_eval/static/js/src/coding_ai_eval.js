/* Javascript for CodingAIEvalXBlock. */
function CodingAIEvalXBlock(runtime, element, data) {
  const runCodeHandlerURL = runtime.handlerUrl(element, "submit_code_handler");
  const resetHandlerURL = runtime.handlerUrl(element, "reset_handler");


  const submissionResultURL = runtime.handlerUrl(
    element,
    "get_submission_result_handler",
  );
  loadMarkedInIframe(data.marked_html);
  const llmResponseHandlerURL = runtime.handlerUrl(element, "get_response");
  const HTML_CSS = "HTML/CSS";
  const HTML_PLACEHOLER =
    "<!DOCTYPE html>\n<html>\n<head>\n<style>\nbody {background: linear-gradient(90deg, #ffecd2, #fcb69f);}\nh1   {font-style: italic;}\np    {border: 2px solid powderblue;}\n</style>\n</head>\n<body>\n<h1>This is a heading</h1>\n<p>This is a paragraph.</p>\n</body>\n</html>";

  const iframe = $("#monaco", element)[0];
  const submitButton = $("#submit-button", element);
  const resetButton = $("#reset-button", element);
  const AIFeeback = $("#ai-feedback", element);
  const stdout = $(".stdout", element);
  const stderr = $(".stderr", element);
  const htmlRenderIframe = $(".html-render", element);

  const MAX_JUDGE0_RETRY_ITER = 5;
  const WAIT_TIME_MS = 1000;

  $(function () {
    // The newer runtime uses the 'data-usage' attribute, while the LMS uses 'data-usage-id'
    // A Jquery object can sometimes be returned e.g. after a studio field edit, we handle it with ?.[0]
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
    iframe.srcdoc = data.monaco_html.replace(
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
      let retries = 0;
      const deferred = $.Deferred();

      function attempt() {
        return $.ajax({
          url: submissionResultURL,
          method: "POST",
          data: JSON.stringify({ submission_id: data.submission_id }),
        })
          .then(function (result) {
            console.log("result", result, retries)
            if (result.status.id === 1 || result.status.id === 2) {
              // https://ce.judge0.com/#statuses-and-languages-status-get 
              // Retry if status is 1 (In Queue) or 2 (Processing)
              if (retries < MAX_JUDGE0_RETRY_ITER) {
                retries++;
                console.log("Judge0 fetch result retry attempt:", retries);
                setTimeout(function () {
                  attempt();
                }, WAIT_TIME_MS);
              } else {
                deferred.reject(new Error("Judge0 submission result fetch failed after " + MAX_JUDGE0_RETRY_ITER + " attempts."));
              }
            } else {
              const output = [result.compile_output, result.stdout].join("\n").trim();
              stdout.text(output);
              stderr.text(result.stderr);
              deferred.resolve(result);
            }


          })
          .fail(function (error) {
            console.log("Error: ", error);
            deferred.reject(new Error("An error occured while trying to fetch Judge0 submission result."));
          });
      }
      attempt();
      return deferred.promise();
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
      $.ajax({
        url: resetHandlerURL,
        method: "POST",
        data: JSON.stringify({}),
        success: function (data) {
          iframe.contentWindow.editor.setValue("");
          AIFeeback.html("");
          if (data.language !== HTML_CSS) {
            stdout.text("");
            stderr.text("");
          }
        },
        error: function(xhr) {
          console.error('Error:', xhr);
          try {
            const response = JSON.parse(xhr.responseText);
            alert(response.error || "A problem occured during reset.");
          } catch (e) {
            alert("A problem occured during reset.");
          }
        }
      });

    });

    submitButton.click(() => {
      const code = iframe.contentWindow.editor.getValue();
      if (!code?.length) {
        return;
      }
      disableSubmitButton();
      var deferred = null;
      if (data.language === HTML_CSS) {
        // no need to submit HTML code, we directly get LLM feedback
        deferred = getLLMFeedback({ stdout: "", stderr: "" });
      } else {
        deferred = submitCode()
          .then(function (data) {
            return delay(WAIT_TIME_MS * 2, data);
          })
          .then(getSubmissionResult)
          .then(getLLMFeedback);
      }

      deferred
        .done(function (data) {
          enableSubmitButton();
        })
        .fail(function (xhr) {
          console.log("Error: ", xhr);
          enableSubmitButton();
          try {
            const response = JSON.parse(xhr.responseText);
            alert(response.error || "A problem occured while submitting the code.");
          } catch (e) {
            alert("A problem occured while submitting the code.");
          }
        });
    });

    function init() {
      $("#question-text", element).html(MarkdownToHTML(data.question));
      // Triggered when the Monaco editor loads.
      // Since a Unit can have multiple instances of this Xblock,
      // we use the XblockUsageId to differentiate between them.
      window.addEventListener("message", function (event) {
        if (event.data === xblockUsageId) {
          if (data.code?.length) {
            iframe.contentWindow.editor.setValue(data.code);
          }

          AIFeeback.html(MarkdownToHTML(data.ai_evaluation || ""));
          if (data.language === HTML_CSS) {
            // render HTML/CSS into iframe
            if (data.code?.length) {
              renderUserHTML(data.code);
            } else {
              iframe.contentWindow.editor.setValue(HTML_PLACEHOLER);
              renderUserHTML(HTML_PLACEHOLER);
            }
            addMonacoHTMLRenderEventListener();
          } else {
            // load existing results for executable languages
            stdout.text(data.code_exec_result?.stdout || "");
            stderr.text(data.code_exec_result?.stderr || "");
          }
        }
      });
    }
    function addMonacoHTMLRenderEventListener() {
      iframe.contentWindow.editor.onDidChangeModelContent((event) => {
        renderUserHTML(iframe.contentWindow.editor.getValue());
      });
    }
    function renderUserHTML(userHTML) {
      htmlRenderIframe.attr("srcdoc", stripScriptTags(userHTML));
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
