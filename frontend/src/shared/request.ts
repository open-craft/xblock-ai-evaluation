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

async function parseResponseBody(response: Response): Promise<ResponsePayload> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as UnknownRecord;
  } catch (error) {
    return { raw: text };
  }
}

function extractResponseError(response: Response, payload: ResponsePayload) {
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
  if (!document.cookie) {
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

function csrfHeaders(): Record<string, string> {
  const csrfToken = getCookie("csrftoken");
  return csrfToken ? { "X-CSRFToken": csrfToken } : {};
}

async function readResponse<TResponse>(response: Response): Promise<TResponse> {
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new RequestError(extractResponseError(response, body), response.status, body);
  }

  return body as TResponse;
}

export async function postJson<TResponse extends UnknownRecord = UnknownRecord>(
  url: string,
  payload: unknown = {},
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(),
    },
    body: JSON.stringify(payload),
  });
  return readResponse<TResponse>(response);
}

/**
 * Send a file as the raw body of a PUT request, with `params` in the query string and any extra `headers`. The
 * browser sets the Content-Type from the file. On an error status it throws a RequestError carrying the JSON error
 * body.
 */
export async function putFile<TResponse>(
  url: string,
  file: File,
  params: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<TResponse> {
  const requestUrl = new URL(url, window.location.href);
  Object.keys(params).forEach((name) => {
    requestUrl.searchParams.set(name, params[name]);
  });

  const response = await fetch(requestUrl.toString(), {
    method: "PUT",
    credentials: "same-origin",
    headers: { ...headers, ...csrfHeaders() },
    body: file,
  });
  return readResponse<TResponse>(response);
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof RequestError && error.message) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}
