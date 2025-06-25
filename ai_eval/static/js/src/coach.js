/* Javascript for CoachAIEvalXBlock. */
function CoachAIEvalXBlock(runtime, element, data) {
  "use strict";

  const formatAIMessage = function(message) {
    var name;
    if (message.character.role === "evaluator") {
      name = gettext("Evaluator");
    } else {
      name = message.character.name;
      var role_text = message.character.role;
      if (role_text) {
        role_text = `<i>${message.character.role}</i>`;
        if (name) {
          name = `${name} (${role_text})`;
        } else {
          name = role_text;
        }
      }
    }
    if (name) {
      name = `${name}:`;
    } else {
      name = "";
    }

    return $(`
      <b>${name}</b>
      ${MarkdownToHTML(message.content)}
    `);
  };

  const handleChatboxInit = function() {
    if (this.chatboxIndex === 0) {
      this.insertAIMessage(formatInitialMessage());
    }

    var chatHistory = data.chat_histories[this.chatboxIndex];
    for (var i = 0; i < chatHistory.length; i++) {
      var message = chatHistory[i];
      if (message.character.role == "user") {
        this.insertUserMessage(message.content);
      } else {
        this.insertAIMessage(formatAIMessage(message));
      }
    }

    var hasUserMessages = false;
    for (var i = 0; !hasUserMessages && i < data.chat_histories.length; i++) {
      var chatHistory = data.chat_histories[i];
      for (var j = 0; !hasUserMessages && j < chatHistory.length; j++) {
        var message = chatHistory[j];
        if (message.character.role == "user") {
          hasUserMessages = true;
        }
      }
    }
    this.enableReset(data.allow_reset && hasUserMessages);
    this.enableInput(!data.finished);
  };

  const handleResponse = function(response) {
    this.insertAIMessage(formatAIMessage(response.message));
    this.enableReset(data.allow_reset);
    this.enableInput(true);
  };

  const formatInitialMessage = function() {
    return formatAIMessage(data.initial_message);
  };

  const handleReset = function() {
    if (this.chatboxIndex === 0) {
      this.insertAIMessage(formatInitialMessage());
    }
  };

  ChatBoxMulti(runtime, element, data, handleChatboxInit, handleResponse,
               handleReset);
}
