/* Javascript for ShortAnswerAIEvalXBlock. */
function ShortAnswerAIEvalXBlock(runtime, element, data) {
  "use strict";

  const formatAIMessage = function(msg) {
    return $(MarkdownToHTML(msg));
  };

  const handleInit = function() {
    $("#question-text", element).html(MarkdownToHTML(data.question));
    for (var i = 0; i < data.messages.USER.length; i++) {
      this.insertUserMessage(data.messages.USER[i]);
      this.insertAIMessage(formatAIMessage(data.messages.LLM[i]));
    }
    this.enableInput(data.messages.USER.length < data.max_responses);
    this.enableReset(data.messages.USER.length > 0);
  };

  const handleResponse = function(response) {
    this.insertAIMessage(formatAIMessage(response.response));
    this.enableInput($(".user-answer", element).length < data.max_responses);
  };

  const handleReset = function() {};

  ChatBox(runtime, element, data, handleInit, handleResponse, handleReset);
}
