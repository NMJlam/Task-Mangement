import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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
