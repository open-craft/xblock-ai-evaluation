/* Javascript for CoachAIEvalXBlock. */
function CoachAIEvalXBlock(runtime, element, data) {
  "use strict";

  const formatAIMessage = function(message) {
    var name;
    if (message.character.role === "evaluator") {
      name = gettext("Evaluator");
    } else {
      name = message.character.name;
      var roleText = message.character.role;
      if (roleText) {
        roleText = `<i>${message.character.role}</i>`;
        if (name) {
          name = `${name} (${roleText})`;
        } else {
          name = roleText;
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

  const formatInitialMessage = function() {
    return formatAIMessage(data.initial_message);
  };

  const handleChatboxInit = function() {
    if (this.chatboxIndex === 0 && data.initial_message.content) {
      this.insertAIMessage(formatInitialMessage());
    }

    var chatHistory = data.chat_histories[this.chatboxIndex];
    for (var i = 0; i < chatHistory.length; i++) {
      var message = chatHistory[i];
      if (message.character.role === "user") {
        this.insertUserMessage(message.content);
      } else {
        this.insertAIMessage(formatAIMessage(message));
      }
    }

    var hasUserMessages = false;
    for (var historyIndex = 0; !hasUserMessages && historyIndex < data.chat_histories.length; historyIndex++) {
      var chatHistory = data.chat_histories[historyIndex];
      for (var messageIndex = 0; !hasUserMessages && messageIndex < chatHistory.length; messageIndex++) {
        var chatMessage = chatHistory[messageIndex];
        if (chatMessage.character.role === "user") {
          hasUserMessages = true;
        }
      }
    }
    this.enableReset(data.allow_reset && hasUserMessages);
    this.enableInput(!data.finished);
    if (!data.finished) {
      this.focusInput();
    }
  };

  const handleResponse = function(response) {
    data.finished = data.finished || Boolean(response.finished);
    this.insertAIMessage(formatAIMessage(response.message));
    this.enableReset(data.allow_reset);
    const finished = data.finished;
    this.enableInput(!finished);
    if (!finished) {
      this.focusInput();
    }
    this.announce(gettext("Assistant response ready."));
  };

  const handleReset = function() {
    if (this.chatboxIndex === 0 && data.initial_message.content) {
      this.insertAIMessage(formatInitialMessage());
    }
    data.finished = false;
  };

  ChatBoxMulti(runtime, element, data, handleChatboxInit, handleResponse,
               handleReset);
}
