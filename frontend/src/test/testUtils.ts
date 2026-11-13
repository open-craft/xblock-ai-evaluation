import { XBlockRuntime } from "../shared/types";

/**
 * Build a fake XBlock runtime whose handler URLs are derived from the handler
 * name, so components that call `runtime.handlerUrl(element, "studio_submit")`
 * get a predictable `/handler/studio_submit` URL.
 */
export function makeRuntime(): XBlockRuntime & { notify: jest.Mock } {
  return {
    handlerUrl: jest.fn(
      (_element, handler) => `/handler/${handler}`,
    ),
    notify: jest.fn(),
  } as unknown as XBlockRuntime & { notify: jest.Mock };
}

/** Stub `fetch` with a successful Studio submit response and return the mock. */
export function mockSuccessfulSave() {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify({
      success: true,
      validation_errors: {},
      validation_warnings: [],
      meta: {},
    })),
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

/**
 * Build a JSON `File` for upload tests. jsdom's `File` does not implement
 * `.text()`, which the importer relies on, so it is stubbed here.
 */
export function makeJsonFile(contents: string, name = "component.json") {
  const file = new File([contents], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(contents),
  });
  return file;
}

/** Return the file input rendered by a Paragon `Dropzone`. */
export function getFileInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}
