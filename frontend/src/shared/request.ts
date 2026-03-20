import { UnknownRecord } from "./types";

interface RawTextPayload {
  raw: string;
}

type ResponsePayload = UnknownRecord | RawTextPayload;

export class RequestError extends Error {
  payload: ResponsePayload;

  status: number;

  constructor(message: string, status: number, payload: ResponsePayload) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.payload = payload;
    Object.setPrototypeOf(this, RequestError.prototype);
  }
}

function parseResponseBody(response: Response): Promise<ResponsePayload> {
  return response.text().then((text) => {
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as UnknownRecord;
    } catch (error) {
      return { raw: text };
    }
  });
}

function getErrorMessage(response: Response, payload: ResponsePayload) {
  if ("error" in payload && typeof payload.error === "string" && payload.error) {
    return payload.error;
  }

  if ("message" in payload && typeof payload.message === "string" && payload.message) {
    return payload.message;
  }

  if (response.statusText) {
    return response.statusText;
  }

  return "Request failed.";
}

function getCookie(name: string) {
  if (typeof document === "undefined" || !document.cookie) {
    return null;
  }

  const prefix = encodeURIComponent(name) + "=";
  const cookies = document.cookie.split(";");

  for (let index = 0; index < cookies.length; index += 1) {
    const cookie = cookies[index].trim();
    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.slice(prefix.length));
    }
  }

  return null;
}

export function postJson<TResponse extends UnknownRecord = UnknownRecord>(
  url: string,
  payload?: unknown,
): Promise<TResponse> {
  const csrfToken = getCookie("csrftoken");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (csrfToken) {
    headers["X-CSRFToken"] = csrfToken;
  }

  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(payload || {}),
  }).then((response) => {
    return parseResponseBody(response).then((body) => {
      if (!response.ok) {
        throw new RequestError(getErrorMessage(response, body), response.status, body);
      }

      return body as TResponse;
    });
  });
}
