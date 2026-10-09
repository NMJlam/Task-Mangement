import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyTheme, THEMES } from "./lib/theme";

// index.html paints the stored theme before the first frame, ahead of
// main.tsx's applyTheme. The two must agree, or a palette reader gets a flash
// of some other theme on every load.
const html = readFileSync(path.join(import.meta.dirname, "..", "index.html"), "utf8");
const prePaint = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? "";

function rootState() {
  const root = document.documentElement;
  return { dark: root.classList.contains("dark"), theme: root.getAttribute("data-theme") };
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
});

it.each(THEMES)("paints %s before the app the way applyTheme does", (theme) => {
  applyTheme(theme);
  const expected = rootState();
  applyTheme("light");

  localStorage.setItem("theme", theme);
  new Function(prePaint)();

  expect(rootState()).toEqual(expected);
});
