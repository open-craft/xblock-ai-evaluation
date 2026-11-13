import React from "react";
import userEvent from "@testing-library/user-event";
import * as Yup from "yup";

import { render, screen, waitFor } from "../test/helpers";
import { JSONImporter } from "./JSONImporter";
import { XBlockRuntime } from "./types";

function makeRuntime(): XBlockRuntime & { notify: jest.Mock } {
  return {
    handlerUrl: jest.fn(
      (_element, handler) => `/handler/${handler}`,
    ),
    notify: jest.fn(),
  } as unknown as XBlockRuntime & { notify: jest.Mock };
}

function makeFile(contents: string, name = "component.json") {
  const file = new File([contents], name, { type: "application/json" });
  // jsdom's File does not implement .text(), which the component uses.
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(contents),
  });
  return file;
}

function getFileInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function mockFetchResponse(body: unknown, ok = true) {
  const mockFetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    statusText: ok ? "OK" : "Bad Request",
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  global.fetch = mockFetch;
  return mockFetch;
}

describe("JSONImporter", () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => "blob:mock");
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  it("renders the export download button", () => {
    const runtime = makeRuntime();

    render(
      <JSONImporter
        liveData={{ display_name: "Example" }}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    expect(screen.getByRole("button", { name: "Download JSON" })).toBeInTheDocument();
  });

  it("exports the live editor data as a JSON download", async () => {
    const user = userEvent.setup();
    const runtime = makeRuntime();
    const liveData = { display_name: "Example", max_responses: 3 };

    render(
      <JSONImporter
        liveData={liveData}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Download JSON" }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as jest.Mock).mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toEqual(liveData);
  });

  it("posts the uploaded JSON and notifies the runtime on success", async () => {
    const runtime = makeRuntime();
    const fetch = mockFetchResponse({
      success: true,
      validation_errors: {},
      validation_warnings: [],
      meta: {},
    });
    const { container } = render(
      <JSONImporter
        liveData={{}}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );
    const data = { display_name: "Imported" };

    await userEvent.upload(getFileInput(container), makeFile(JSON.stringify(data)));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/handler/studio_submit",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(runtime.notify).toHaveBeenCalledWith("save", { state: "start" });
    expect(runtime.notify).toHaveBeenCalledWith("save", { state: "end" });
  });

  it("validates the uploaded JSON with the Yup schema and reports errors", async () => {
    const runtime = makeRuntime();
    const fetch = mockFetchResponse({});
    const schema = Yup.object({
      max_responses: Yup.number().typeError("Input should be a valid integer").required(),
      question: Yup.string().required("Question is mandatory"),
    });
    const { container } = render(
      <JSONImporter
        liveData={{}}
        runtime={runtime}
        element={document.createElement("div")}
        schema={schema}
      />,
    );

    await userEvent.upload(
      getFileInput(container),
      makeFile(JSON.stringify({ max_responses: "nope" })),
    );

    expect(await screen.findByText("JSON validation failed!")).toBeInTheDocument();
    expect(screen.getByText("max_responses")).toBeInTheDocument();
    expect(screen.getByText("Input should be a valid integer")).toBeInTheDocument();
    expect(screen.getByText("question")).toBeInTheDocument();
    expect(screen.getByText("Question is mandatory")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(runtime.notify).not.toHaveBeenCalled();
  });

  it("reports top-level validation error message when error has no field path", async () => {
    const runtime = makeRuntime();
    const fetch = mockFetchResponse({});
    const schema = Yup.object().test(
      "root-check",
      "Root validation failed",
      () => false,
    );
    const { container } = render(
      <JSONImporter
        liveData={{}}
        runtime={runtime}
        element={document.createElement("div")}
        schema={schema}
      />,
    );

    await userEvent.upload(
      getFileInput(container),
      makeFile(JSON.stringify({ test: "data" })),
    );

    expect(await screen.findByText("JSON validation failed!")).toBeInTheDocument();
    expect(screen.getByText("Root validation failed")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts valid JSON when Yup schema validation passes", async () => {
    const runtime = makeRuntime();
    const fetch = mockFetchResponse({
      success: true,
      validation_errors: {},
      validation_warnings: [],
      meta: {},
    });
    const schema = Yup.object({
      display_name: Yup.string().required(),
    });
    const { container } = render(
      <JSONImporter
        liveData={{}}
        runtime={runtime}
        element={document.createElement("div")}
        schema={schema}
      />,
    );
    const data = { display_name: "Imported" };

    await userEvent.upload(getFileInput(container), makeFile(JSON.stringify(data)));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/handler/studio_submit",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(runtime.notify).toHaveBeenCalledWith("save", { state: "start" });
    expect(runtime.notify).toHaveBeenCalledWith("save", { state: "end" });
  });

  it("shows validation errors returned by the save handler when no schema is provided", async () => {
    const runtime = makeRuntime();
    mockFetchResponse({
      success: false,
      validation_errors: {
        max_responses: ["Input should be a valid integer"],
      },
      validation_warnings: [],
      meta: {},
    });
    const { container } = render(
      <JSONImporter
        liveData={{}}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    await userEvent.upload(
      getFileInput(container),
      makeFile(JSON.stringify({ max_responses: "nope" })),
    );

    expect(await screen.findByText("JSON validation failed!")).toBeInTheDocument();
    expect(screen.getByText("max_responses")).toBeInTheDocument();
    expect(screen.getByText("Input should be a valid integer")).toBeInTheDocument();
  });

  it("rejects invalid JSON without posting it", async () => {
    const runtime = makeRuntime();
    const fetch = mockFetchResponse({});
    const { container } = render(
      <JSONImporter
        liveData={{}}
        runtime={runtime}
        element={document.createElement("div")}
      />,
    );

    await userEvent.upload(getFileInput(container), makeFile("{ not valid json"));

    const messages = await screen.findAllByText("Invalid JSON.");
    expect(messages.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
