import { getErrorMessage, postJson, putFile, RequestError } from "./request";

describe("getErrorMessage", () => {
  it("returns RequestError message when available", () => {
    const error = new RequestError("server error", 500, {});
    expect(getErrorMessage(error, "fallback")).toBe("server error");
  });

  it("returns Error message when available", () => {
    const error = new Error("something broke");
    expect(getErrorMessage(error, "fallback")).toBe("something broke");
  });

  it("returns fallback when error is not an Error instance", () => {
    expect(getErrorMessage("string error", "fallback")).toBe("fallback");
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(getErrorMessage(42, "fallback")).toBe("fallback");
  });

  it("returns fallback when error message is empty string", () => {
    const error = new Error("");
    expect(getErrorMessage(error, "fallback")).toBe("fallback");
  });
});

describe("postJson", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  function mockResponse(body: unknown, status = 200) {
    mockFetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  it("sends POST with JSON content type", async () => {
    mockResponse({ ok: true });

    await postJson("/api/test");

    expect(mockFetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
  });

  it("includes CSRF token from cookie", async () => {
    Object.defineProperty(document, "cookie", {
      value: "csrftoken=abc123",
      writable: true,
      configurable: true,
    });

    mockResponse({});

    await postJson("/api/test");

    expect(mockFetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      headers: expect.objectContaining({ "X-CSRFToken": "abc123" }),
    }));

    Object.defineProperty(document, "cookie", {
      value: "",
      writable: true,
      configurable: true,
    });
  });

  it("sends payload as JSON body", async () => {
    mockResponse({});

    await postJson("/api/test", { key: "value" });

    expect(mockFetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      body: JSON.stringify({ key: "value" }),
    }));
  });

  it("returns parsed JSON response", async () => {
    mockResponse({ data: "result" });

    const result = await postJson("/api/test");
    expect(result).toEqual({ data: "result" });
  });

  it("throws RequestError on non-OK response", async () => {
    mockResponse({ error: "not found" }, 404);

    await expect(postJson("/api/test")).rejects.toThrow(RequestError);
  });

  it("throws RequestError with server error message", async () => {
    expect.assertions(3);
    mockResponse({ error: "bad request" }, 400);

    try {
      await postJson("/api/test");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestError);
      expect((error as RequestError).message).toBe("bad request");
      expect((error as RequestError).status).toBe(400);
    }
  });

  it("defaults payload to empty object when not provided", async () => {
    mockResponse({});

    await postJson("/api/test");

    expect(mockFetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      body: JSON.stringify({}),
    }));
  });
});

describe("putFile", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    mockFetch.mockReset();
    Object.defineProperty(document, "cookie", {
      value: "",
      writable: true,
      configurable: true,
    });
  });

  function mockResponse(body: unknown, status = 200) {
    mockFetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  it("sends the file as a PUT body with the params in the query string, the headers and the CSRF token", async () => {
    Object.defineProperty(document, "cookie", {
      value: "csrftoken=abc123",
      writable: true,
      configurable: true,
    });
    mockResponse({ upload_id: "upload-1" });
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const result = await putFile(
      "/handler/upload_file", file, { pane: "coach" }, { "X-Upload-Filename": "my%20notes.txt" },
    );

    expect(result).toEqual({ upload_id: "upload-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost/handler/upload_file?pane=coach",
      expect.objectContaining({
        method: "PUT",
        body: file,
        headers: { "X-Upload-Filename": "my%20notes.txt", "X-CSRFToken": "abc123" },
      }),
    );
  });

  it("throws a RequestError carrying the error body", async () => {
    mockResponse({ code: "file_too_large", error: "This file is too large." }, 413);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const request = putFile("/handler/upload_file", file, { pane: "coach" });

    await expect(request).rejects.toMatchObject({
      status: 413,
      payload: { code: "file_too_large", error: "This file is too large." },
    });
  });
});
