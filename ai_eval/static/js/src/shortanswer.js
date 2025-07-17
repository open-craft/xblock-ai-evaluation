/* Javascript for ShortAnswerAIEvalXBlock. */
function ShortAnswerAIEvalXBlock(runtime, element, data) {
  "use strict";

  const formatAIMessage = function(msg) {
    return $(MarkdownToHTML(msg));
  };

  const handleInit = function() {
    $("#question-text", element).html(MarkdownToHTML(data.question));
    var userMessageCount = 0;
    for (var i = 0; i < data.messages.length; i++) {
      var message = data.messages[i];
      if (message.source == "user") {
        userMessageCount++;
        this.insertUserMessage(message.content);
      } else if (message.source == "llm") {
        this.insertAIMessage(formatAIMessage(message.content));
      }
    }
    this.enableInput(userMessageCount < data.max_responses);
    this.enableReset(userMessageCount > 0);
  };

  const handleResponse = function(response) {
    this.insertAIMessage(formatAIMessage(response.response));
    this.enableInput($(".user-answer", element).length < data.max_responses);
  };

  const handleReset = function() {};

  ChatBox(runtime, element, data, handleInit, handleResponse, handleReset);
}
