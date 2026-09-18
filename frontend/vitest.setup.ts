import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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
