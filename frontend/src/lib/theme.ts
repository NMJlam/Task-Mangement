/**
 * The palettes Settings offers. Light and dark are the paper pair; the other
 * three are dark terminal palettes, each a `:root[data-theme=…]` token block in
 * `index.css`.
 */
export const THEMES = ["light", "dark", "amber", "green", "gruvbox"] as const;

export type Theme = (typeof THEMES)[number];

/** The palettes drawn from a token block of their own, not just `.dark`. */
const NAMED: readonly Theme[] = ["amber", "green", "gruvbox"];

const KEY = "theme";

function isTheme(value: string | null): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/**
 * The theme this device chose, or light.
 *
 * Storage can be off-limits — site data blocked, some private modes — and
 * touching `localStorage` then throws. `main.tsx` reads this before the first
 * render, where a throw would stop the app from ever drawing, so every access
 * goes through here. A value this build does not know (a palette from a later
 * build, a hand edit) reads as light rather than a half-applied palette.
 */
export function storedTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return isTheme(stored) ? stored : "light";
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

/**
 * Every palette but light is a dark one, so it takes the `dark` class; a named
 * palette also names itself in `data-theme`, whose token block outranks
 * `.dark`. Both are set or cleared on every call, so switching away from a
 * palette leaves none of its tokens behind.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme !== "light");
  if (NAMED.includes(theme)) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
}
