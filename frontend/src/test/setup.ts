import "@testing-library/jest-dom";

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// jsdom does not provide TextDecoder/TextEncoder.
import { TextDecoder, TextEncoder } from "util";

if (typeof globalThis.TextDecoder === "undefined") {
  (globalThis as Record<string, unknown>).TextDecoder = TextDecoder;
}
if (typeof globalThis.TextEncoder === "undefined") {
  (globalThis as Record<string, unknown>).TextEncoder = TextEncoder;
}
