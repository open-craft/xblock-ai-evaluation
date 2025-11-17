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
  const aiFeedbackPanel = $("#ai-feedback-panel", element);
  const stdout = $(".stdout", element);
  const stderr = $(".stderr", element);
  const htmlRenderIframe = $(".html-render", element);
  const resultContainer = $(".result", element);
  const statusRegion = $("#coding-status", element);
  const tabButtons = $(".result-tab-btn", element);
  const tabPanels = $(".tabcontent", element);

  const MAX_JUDGE0_RETRY_ITER = 5;
  const WAIT_TIME_MS = 1000;

  function announceStatus(message) {
    if (!statusRegion.length) {
      return;
    }
    statusRegion.text("");
    if (message) {
      statusRegion.text(message);
    }
  }

  function setBusy(isBusy) {
    if (!resultContainer.length) {
      return;
    }
    if (isBusy) {
      resultContainer.attr("aria-busy", "true");
    } else {
      resultContainer.removeAttr("aria-busy");
    }
  }

  function setProcessingState(isProcessing, options = {}) {
    const showSpinner = options.showSpinner !== false;
    if (isProcessing) {
      if (showSpinner && !$(".submit-loader", element).length) {
        submitButton.append('<i class=\"fa fa-spinner fa-spin submit-loader\"></i>');
      }
      submitButton.prop("disabled", true).addClass("disabled-btn");
      resetButton.prop("disabled", true).addClass("disabled-btn");
      setBusy(true);
    } else {
      $(".submit-loader", element).remove();
      submitButton.prop("disabled", false).removeClass("disabled-btn");
      resetButton.prop("disabled", false).removeClass("disabled-btn");
      setBusy(false);
    }
  }

  function markTabNotification(tabId, hasNewContent) {
    const tab = $("#" + tabId, element);
    if (!tab.length) {
      return;
    }
    if (hasNewContent && tab.attr("aria-selected") !== "true") {
      tab.addClass("result-tab-btn--notify");
    } else {
      tab.removeClass("result-tab-btn--notify");
    }
  }

  function activateTab(tabId, options = {}) {
    const focus = options.focus === true;
    const announceMessage = options.announceMessage;

    tabButtons.each(function () {
      const tab = $(this);
      const isActive = tab.attr("id") === tabId;
      tab.attr({
        "aria-selected": isActive ? "true" : "false",
        tabindex: isActive ? "0" : "-1",
      });
      tab.toggleClass("active", isActive);
      if (isActive) {
        tab.removeClass("result-tab-btn--notify");
        if (focus) {
          tab.trigger("focus");
        }
      }
    });

    tabPanels.each(function () {
      const panel = $(this);
      const isActivePanel = panel.attr("aria-labelledby") === tabId;
      if (isActivePanel) {
        panel.removeAttr("hidden");
        panel.attr("aria-hidden", "false");
      } else {
        panel.attr("hidden", "hidden");
        panel.attr("aria-hidden", "true");
      }
    });

    if (announceMessage) {
      announceStatus(announceMessage);
    }
  }

  function setupTabs() {
    if (!tabButtons.length) {
      return;
    }
    const initiallySelected = tabButtons.filter('[aria-selected=\"true\"]').attr("id") || tabButtons.first().attr("id");
    activateTab(initiallySelected);

    tabButtons.each(function () {
      const tab = $(this);
      const isSelected = tab.attr("aria-selected") === "true";
      tab.attr("tabindex", isSelected ? "0" : "-1");
    });

    tabButtons.on("click", function (event) {
      event.preventDefault();
      activateTab(this.id, { focus: true });
    });

    tabButtons.on("keydown", function (event) {
      const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
      if (!keys.includes(event.key)) {
        return;
      }
      event.preventDefault();
      const currentIndex = tabButtons.index(this);
      let targetIndex = currentIndex;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          targetIndex = (currentIndex + 1) % tabButtons.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          targetIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
          break;
        case "Home":
          targetIndex = 0;
          break;
        case "End":
          targetIndex = tabButtons.length - 1;
          break;
        default:
          break;
      }
      const targetTab = tabButtons.get(targetIndex);
      activateTab(targetTab.id, { focus: true });
    });
  }

  $(function () {
    setupTabs();

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
            if (result.status.id === 1 || result.status.id === 2) {
              // https://ce.judge0.com/#statuses-and-languages-status-get 
              // Retry if status is 1 (In Queue) or 2 (Processing)
              if (retries < MAX_JUDGE0_RETRY_ITER) {
                retries++;
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
            deferred.reject(new Error("An error occurred while trying to fetch Judge0 submission result."));
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
        success: function (response) {
          aiFeedbackPanel.html(MarkdownToHTML(response.response));
          markTabNotification("ai-feedback-tab", true);
          announceStatus(gettext("AI feedback ready. Activate the AI feedback tab to review."));
        },
      });
    }

    resetButton.click(() => {
      if (resetButton.prop("disabled")) {
        return;
      }
      setProcessingState(true, { showSpinner: false });
      announceStatus(gettext("Resetting editor..."));
      $.ajax({
        url: resetHandlerURL,
        method: "POST",
        data: JSON.stringify({}),
        success: function (data) {
          iframe.contentWindow.editor.setValue("");
          aiFeedbackPanel.html("");
          markTabNotification("ai-feedback-tab", false);
          if (data.language !== HTML_CSS) {
            stdout.text("");
            stderr.text("");
          } else if (htmlRenderIframe.length) {
            htmlRenderIframe.attr("srcdoc", "");
          }
          activateTab("output-tab");
          setProcessingState(false, { showSpinner: false });
          announceStatus(gettext("Editor reset. Previous output cleared."));
          try {
            iframe.contentWindow.editor.focus();
          } catch (error) {
            // ignore focus errors
          }
        },
        error: function (xhr) {
          let message = gettext("A problem occurred during reset.");
          if (xhr && xhr.responseText) {
            try {
              const response = JSON.parse(xhr.responseText);
              if (response.error) {
                message = response.error;
              }
            } catch (e) {
              // keep default
            }
          }
          setProcessingState(false, { showSpinner: false });
          announceStatus(message);
          alert(message);
        },
      });
    });

    submitButton.click(() => {
      if (submitButton.prop("disabled")) {
        return;
      }
      const code = iframe.contentWindow.editor.getValue();
      if (!code?.length) {
        announceStatus(gettext("Enter code before submitting."));
        try {
          iframe.contentWindow.editor.focus();
        } catch (error) {
          // ignore
        }
        return;
      }
      markTabNotification("ai-feedback-tab", false);
      announceStatus(gettext("Submitting code..."));
      setProcessingState(true);
      let deferred = null;
      if (data.language === HTML_CSS) {
        announceStatus(gettext("Generating AI feedback..."));
        deferred = getLLMFeedback({ stdout: "", stderr: "" });
      } else {
        deferred = submitCode()
          .then(function (submission) {
            announceStatus(gettext("Code submitted. Checking execution results..."));
            return delay(WAIT_TIME_MS * 2, submission);
          })
          .then(getSubmissionResult)
          .then(function (result) {
            announceStatus(gettext("Execution complete. Output tab updated."));
            return getLLMFeedback(result);
          });
      }

      deferred
        .done(function () {
          setProcessingState(false);
        })
        .fail(function (error) {
          setProcessingState(false);
          let message = gettext("A problem occurred while submitting the code.");
          if (error) {
            if (error.responseText) {
              try {
                const response = JSON.parse(error.responseText);
                if (response.error) {
                  message = response.error;
                }
              } catch (e) {
                // keep default
              }
            } else if (error.message) {
              message = error.message;
            }
          }
          announceStatus(message);
          alert(message);
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

          const existingFeedback = data.ai_evaluation || "";
          aiFeedbackPanel.html(MarkdownToHTML(existingFeedback));
          if (existingFeedback) {
            markTabNotification("ai-feedback-tab", true);
          }
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

}
