export type Theme = "light" | "dark";

const KEY = "theme";

/**
 * The theme this device chose, or light.
 *
 * Storage can be off-limits — site data blocked, some private modes — and
 * touching `localStorage` then throws. `main.tsx` reads this before the first
 * render, where a throw would stop the app from ever drawing, so every access
 * goes through here.
 */
export function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Remembers the choice where storage allows; without it, it lasts this visit. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Nothing to remember it in. The page still shows the choice.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}
