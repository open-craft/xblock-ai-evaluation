function RequestError(message, status, payload) {
  this.name = "RequestError";
  this.message = message;
  this.status = status;
  this.payload = payload;
}

RequestError.prototype = Object.create(Error.prototype);
RequestError.prototype.constructor = RequestError;

function parseResponseBody(response) {
  return response.text().then(function parseText(text) {
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return { raw: text };
    }
  });
}

function getErrorMessage(response, payload) {
  if (payload && typeof payload.error === "string" && payload.error) {
    return payload.error;
  }

  if (payload && typeof payload.message === "string" && payload.message) {
    return payload.message;
  }

  if (response && response.statusText) {
    return response.statusText;
  }

  return "Request failed.";
}

export function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  }).then(function handleResponse(response) {
    return parseResponseBody(response).then(function withBody(body) {
      if (!response.ok) {
        throw new RequestError(getErrorMessage(response, body), response.status, body);
      }

      return body;
    });
  });
}

export { RequestError };
