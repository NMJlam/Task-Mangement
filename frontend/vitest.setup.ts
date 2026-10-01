import "@testing-library/jest-dom/vitest";
import { transferableAbortController } from "node:util";
import { vi } from "vitest";

// jsdom installs its own AbortController/AbortSignal, but Node 24's undici
// `Request` — which react-router's data router builds on every navigation —
// brand-checks the signal against its own and rejects jsdom's. On Node 24 that
// throws inside `startNavigation`, so the navigation never commits and tests
// that click a link or navigate never move. Restore Node's natives (taken here,
// since jsdom has already replaced the globals) so `new Request(url, { signal })`
// accepts them as it does on Node 20.
const NativeAbortController = transferableAbortController().constructor;
globalThis.AbortController = NativeAbortController as typeof AbortController;
globalThis.AbortSignal = new NativeAbortController().signal.constructor as typeof AbortSignal;

// jsdom implements neither of these, and `@dnd-kit/dom` builds a ResizeObserver
// at import time. Minimal stubs so component tests can render.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom doesn't implement matchMedia, which some UI libs (e.g. sonner) call on
// mount. Provide a minimal stub so component tests can render.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});
