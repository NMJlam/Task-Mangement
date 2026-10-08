# Terminal UI, Phase 2 — Console Feedback, ASCII Wordmark, Themes, TE Touches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the terminal feel with ideas 6, 7, 8 and 9 from the 2026-10-08 brainstorm. Idea 6 is console-style feedback: a spinner on loading lines, `[err]`/`[ok]` tags, and shell-prompt empty states. Idea 7 is an ASCII "MAC" wordmark. Idea 8 is a theme switcher with three new terminal palettes. Idea 9 is Teenage Engineering touches: a ruled stat grid with tiny uppercase labels, and a dithered login screen.

**Architecture:** Four small presentational components in `components/common/` (`LoadingLine`, `ShellEmpty`, `LogLine`, `AsciiWordmark`), each adopted where the app already shows that kind of thing, with the existing words kept so behaviour tests still read the same text. Themes stay CSS tokens: `lib/theme.ts` widens `Theme` and applies a palette with the `dark` class plus a `data-theme` attribute, and `index.css` adds one token block per palette.

**Tech Stack:** React 19, Tailwind v4 tokens in `frontend/src/index.css`, Radix via `radix-ui`, sonner, Vitest + Testing Library, Playwright + axe.

**Spec:** Ideas 6–9 of the 2026-10-08 UI brainstorm, as scoped in the session. Ideas 4, 5 and 10 (keyboard layer, TUI selection, multi-panel layouts) are phase 3. Phase 1 lessons carry over: no glyph that Windows draws from a fallback font, and lean tests.

## Global Constraints

- TypeScript `strict`, **no `any`**. Files LF and Prettier-formatted; `npm run lint` and `npm run format:check` clean.
- Colours only from tokens in `index.css`: no `dark:` classes, no Tailwind palette colours, no non-token radii.
- **Pure ASCII for every drawn glyph** (spinner frames, wordmark, tags). Windows draws block, braille and shade characters from a taller fallback font, as phase 1 found with `░`.
- Decorative glyphs are `aria-hidden`. Messages keep their existing words, so screen readers and tests read the same text.
- Motion respects `prefers-reduced-motion`: the spinner stands still.
- Every new palette meets the docs/accessibility.md thresholds: text 4.5:1, field boundary and focus 3:1. Measured values go in the doc.
- **Lean tests** (user direction: the suite is already large): one behaviour test per new component, and existing tests updated rather than new ones added beside them. No class-name pins.
- **Incremental commits**: one per task or sub-step, Conventional Commits, no attribution trailers.

## Review Focus

1. **Theme persistence across reloads**, including an unknown stored value (e.g. a theme from a future build) and blocked storage. These must fall back to light, never a half-applied palette. Pinned in Task 6.
2. **Switching away from a palette** (amber → light, say). It must remove both the `dark` class and the `data-theme` attribute, so no stale tokens remain. Pinned in Task 6.
3. **Reduced motion**: the spinner must not animate when the user asks for less motion. Pinned in Task 1.
4. **The wordmark at narrow widths**: the sidebar's ASCII art must fit 15rem without wrapping a line. A wrapped line destroys ASCII art. Checked by screenshot in Task 11.
5. **The dithered login texture must not lower text contrast**: it sits behind the copy only where faded out. Checked by screenshot and axe in Task 11.

---

## File Structure

| File                                                         | Responsibility                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `frontend/src/components/common/loading-line.tsx` (+ test)   | `LoadingLine`: `role="status"` with a pure-ASCII `\|/-\` spinner         |
| `frontend/src/components/common/shell-empty.tsx`             | `ShellEmpty`: `$ ls tasks/` prompt line above the existing empty message |
| `frontend/src/components/common/log-line.tsx`                | `LogLine`: `[err]`/`[ok]` tag before a message, alert or status          |
| `frontend/src/components/common/ascii-wordmark.tsx` (+ test) | `AsciiWordmark`: figlet "standard" MAC, `role="img"` named MAC           |
| `frontend/src/components/ui/sonner.tsx`                      | Toast icons become `[ok]` / `[err]` / `[!!]` / `[..]`                    |
| `frontend/src/lib/theme.ts` (+ test)                         | `THEMES`, `Theme`, safe read, apply (class + `data-theme`)               |
| `frontend/src/index.css`                                     | Amber, green and Gruvbox token blocks; `.dither` texture                 |
| `frontend/src/routes/settings.tsx` (+ test)                  | Five theme choices with swatches                                         |
| `frontend/src/routes/dashboard.tsx` (+ test)                 | "At a glance" ruled stat grid with tiny uppercase labels                 |
| `frontend/src/routes/login.tsx`                              | Wordmark and dithered texture on the screen panel                        |
| `frontend/src/components/layout/app-shell.tsx`               | Sidebar brand becomes the small wordmark                                 |
| pages with loading, empty and error lines                    | Adopt `LoadingLine` / `ShellEmpty` / `LogLine`                           |
| `docs/accessibility.md`                                      | Palette contrast tables; spinner, wordmark and dither notes              |

---

### Task 1: LoadingLine

**Files:** Create `components/common/loading-line.tsx` and `loading-line.test.tsx`.

**Produces:** `LoadingLine({ label, className? })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoadingLine } from "./loading-line";

afterEach(() => vi.useRealTimers());

it("announces its label as a status and turns an ASCII spinner, hidden from assistive tech", () => {
  vi.useFakeTimers();
  render(<LoadingLine label="Loading Members…" />);

  const status = screen.getByRole("status");
  expect(screen.getByText("Loading Members…")).toBeInTheDocument();
  const spinner = status.querySelector("[aria-hidden]")!;
  const first = spinner.textContent;
  act(() => vi.advanceTimersByTime(130));
  expect(spinner.textContent).not.toBe(first);
  expect(["|", "/", "-", "\\"]).toContain(spinner.textContent);
});
```

- [ ] **Step 2: Run it and see it fail** (the module is missing).
- [ ] **Step 3: Implement.** Use frames `["|", "/", "-", "\\"]` on a 120ms interval. When `window.matchMedia("(prefers-reduced-motion: reduce)").matches`, don't start the interval and show `-`. Render `<p role="status" className={cn("text-sm text-muted-foreground", className)}><span aria-hidden="true" className="inline-block w-[1ch] font-mono text-ring">{frame}</span> <span>{label}</span></p>`. The label sits in its own span so `getByText(label)` keeps matching.
- [ ] **Step 4: Run it and see it pass. Commit:** `feat(ui): add a loading line with an ASCII spinner`.

### Task 2: Adopt LoadingLine

- [ ] Replace every `<p ... role="status">Loading X…</p>` (`grep -rn 'role="status"' frontend/src --include=*.tsx`, ignoring tests) with `<LoadingLine label="Loading X…" className="mt-8" />`, keeping each element's own margin classes. The existing tests' `getByText("Loading X…")` keep passing.
- [ ] Run `npm run test:unit` and fix only real breakage. **Commit:** `feat(ui): show loading lines with the spinner across the app`.

### Task 3: ShellEmpty and LogLine

**Files:** Create `components/common/shell-empty.tsx` and `log-line.tsx`. Modify `components/ui/sonner.tsx` and the adopting pages.

- [ ] `ShellEmpty({ command, message, compact? })` renders a `div` with `<p aria-hidden="true" className="font-mono text-xs text-muted-foreground"><span className="text-ring">$</span> {command}</p>`, then `<p className="mt-2 text-sm text-muted-foreground">{message}</p>`. Centred, with `py-12` (or `py-6` when compact).
- [ ] Adopt it:
  - In place of the dashboard's `EmptyState`, keeping each message. The commands are `ls tasks/`, `ls events/`, `cal today` and `tail inbox`; the committee one is `ls members/`.
  - In the dashed-card empties on Events (`ls events/`), Members (`ls members/`), the Inbox (`tail inbox`), the task board (`ls tasks/`), Finance's expenses (`ls expenses/`) and Messages (`ls threads/`).
  - Keep every message's words.
- [ ] `LogLine({ tone: "err" | "ok", children, className? })` renders `<p role={tone === "err" ? "alert" : "status"} className={cn("text-sm", tone === "err" ? "text-destructive" : "text-muted-foreground", className)}><span aria-hidden="true" className="font-mono">[{tone}]</span> {children}</p>`.
- [ ] Adopt `LogLine` for each page-level load failure ("Couldn't load … Refresh the page to try again.") and each page-top mutation error. Keep the words: tests match them as substrings of the alert.
- [ ] sonner: pass `icons={{ success: <Tag>ok</Tag>, error: <Tag>err</Tag>, warning: <Tag>!!</Tag>, info: <Tag>..</Tag> }}`, where `Tag` renders `<span className="font-mono">[…]</span>`.
- [ ] Unit suite green. **Commits:** `feat(ui): draw empty states as shell output`, then `feat(ui): tag errors and toasts like log lines`.

### Task 4: ASCII wordmark

**Files:** Create `components/common/ascii-wordmark.tsx` and its test. Modify `routes/login.tsx` and `components/layout/app-shell.tsx`.

- [ ] **Test first:**

```tsx
it("draws MAC in ASCII, named MAC for assistive tech", () => {
  render(<AsciiWordmark />);
  const mark = screen.getByRole("img", { name: "MAC" });
  expect(mark.textContent).toContain("|  \\/  |");
});
```

- [ ] **Implement:**

```tsx
const MAC = String.raw` __  __    _    ____
|  \/  |  / \  / ___|
| |\/| | / _ \| |
| |  | |/ ___ \ |___
|_|  |_/_/   \_\____|`;

export function AsciiWordmark({ className }: { className?: string }) {
  return (
    <pre
      role="img"
      aria-label="MAC"
      className={cn("font-mono leading-[1.05] whitespace-pre select-none", className)}
    >
      {MAC}
    </pre>
  );
}
```

These are figlet "standard" letters: pure ASCII, so the art lines up in any monospace font.

- [ ] **Login:** the screen panel's top-left M box and "MAC" become `<AsciiWordmark className="text-sm text-screen-foreground" />` with "Club Operations" below. The small-screen header keeps the M box.
- [ ] **Sidebar** (`Brand`, not `compact`): `<AsciiWordmark className="text-[0.5625rem] text-foreground" />` followed by `<p className="mt-1.5 text-xs text-muted-foreground">Club Operations<span aria-hidden="true" className="caret" /></p>`. The compact brand (mobile header) is unchanged.
- [ ] **Commit:** `feat(ui): set the MAC wordmark in ASCII on the login screen and sidebar`.

### Task 5: Palette tokens

**Files:** Modify `frontend/src/index.css` and `docs/accessibility.md`.

- [ ] After the `.dark` block, add `:root[data-theme="amber"]`, `[data-theme="green"]` and `[data-theme="gruvbox"]` blocks. Each sets `color-scheme: dark` and every token `.dark` sets. Values are measured, and all pass:

| token                                                                 | amber             | green   | gruvbox |
| --------------------------------------------------------------------- | ----------------- | ------- | ------- |
| background                                                            | #120d05           | #03110a | #282828 |
| foreground / card-, popover-, accent-, secondary-foreground / primary | #ffb54d           | #5dfc8d | #ebdbb2 |
| card / popover / secondary / muted                                    | #1a1408           | #071a10 | #32302f |
| muted-foreground                                                      | #d29a45           | #46c873 | #bdae93 |
| accent                                                                | #271d0c           | #0d2617 | #3c3836 |
| primary-foreground / destructive-, today-foreground                   | #120d05           | #03110a | #282828 |
| destructive / danger / today                                          | #ff8a6b           | #ff8f85 | #fb6b5b |
| border                                                                | #3a2c14           | #183a25 | #504945 |
| input                                                                 | #9a7438           | #2f8a52 | #928374 |
| ring                                                                  | #fff0d1           | #dcffe6 | #fe8019 |
| ok                                                                    | #b8d96a           | #5dfc8d | #b8bb26 |
| warn                                                                  | #ffd27a           | #ffd27a | #fabd2f |
| scrim                                                                 | rgb(0 0 0 / 0.72) | same    | same    |

`--screen*` stays as the root defines it: the login screen is a fixed terminal surface in every theme.

- [ ] docs/accessibility.md: under "Contrast table", add one table per palette (the measured pairs from the plan's contrast run), and record that the signed-in axe scans were run once per new theme (Task 11).
- [ ] **Commit:** `feat(theme): add amber, green phosphor and Gruvbox palettes`.

### Task 6: Theme model

**Files:** Modify `frontend/src/lib/theme.ts` and `theme.test.ts`.

- [ ] **Test first** (replace the file's first test, keeping the blocked-storage test):

```ts
it("reads back any theme this build knows, and light for one it does not", () => {
  localStorage.setItem("theme", "amber");
  expect(storedTheme()).toBe("amber");
  localStorage.setItem("theme", "neon");
  expect(storedTheme()).toBe("light");
});

it("applies a palette with the dark class and its name, and clears both on the way back", () => {
  applyTheme("gruvbox");
  expect(document.documentElement).toHaveClass("dark");
  expect(document.documentElement).toHaveAttribute("data-theme", "gruvbox");
  applyTheme("light");
  expect(document.documentElement).not.toHaveClass("dark");
  expect(document.documentElement).not.toHaveAttribute("data-theme");
});
```

- [ ] **Implement:** `export const THEMES = ["light", "dark", "amber", "green", "gruvbox"] as const; export type Theme = (typeof THEMES)[number];`.
  - `storedTheme` returns the stored value when it is in `THEMES`, and `"light"` otherwise or on throw.
  - `applyTheme` toggles the `dark` class for anything but light, sets `data-theme` for the three palettes, and removes it for light and dark.
- [ ] **Commit:** `feat(theme): let the theme be any of five terminal palettes`.

### Task 7: Settings picker

**Files:** Modify `frontend/src/routes/settings.tsx` and `settings.test.tsx`.

- [ ] The two-option grid becomes five, with the same `aria-pressed` button pattern:
  - Light: "Paper, crisp and clear"
  - Dark: "Comfortable at night"
  - Amber: "Amber phosphor"
  - Green: "Green phosphor"
  - Gruvbox: "Warm retro"

  Each shows a three-square swatch (background, foreground, ring) drawn from literal hex values, so a palette can be previewed before it is applied. The swatches are `aria-hidden`; the button's name carries the choice.

- [ ] Update the existing "persists and applies the selected theme" test to choose Amber and expect `data-theme="amber"` stored and applied.
- [ ] **Commit:** `feat(settings): choose among the five terminal palettes`.

### Task 8: At-a-glance stat grid

**Files:** Modify `frontend/src/routes/dashboard.tsx` and `dashboard.test.tsx`.

- [ ] Replace the "Overview statistics" section of four `Metric` panels with one `<Panel title="At a glance" className="mt-6" bodyClassName="px-0 pt-1 pb-0">`. It contains `<dl className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">`, whose cells are `<div className="bg-card px-4 py-3">`:
  - `<dt className="text-[0.6875rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">{label}</dt>`
  - `<dd className="mt-1 text-3xl font-semibold tabular-nums …">{value}</dd>`
  - `<dd className="text-xs text-muted-foreground">{detail}</dd>`

  The 1px gaps over `bg-border` are the grid lines. Keep "unavailable" for a missing value and `text-destructive` for the danger tone. This also cuts four landmark regions to one (a deferred minor from phase 1).

- [ ] Update the tests that read `region "Overview statistics"` and the panel test's metric region name to use `region "At a glance"`.
- [ ] **Commit:** `feat(dashboard): set the Overview's figures in one ruled grid`.

### Task 9: Dithered login screen

**Files:** Modify `frontend/src/index.css` and `routes/login.tsx`.

- [ ] Add `.dither` to `index.css`:

```css
.dither {
  background-image: radial-gradient(
    color-mix(in srgb, var(--screen-foreground) 14%, transparent) 0.7px,
    transparent 0.9px
  );
  background-size: 4px 4px;
  mask-image: linear-gradient(to bottom right, transparent 35%, black);
}
```

- [ ] In the login screen panel, add `<div aria-hidden="true" className="dither pointer-events-none absolute inset-0" />` as its first child. The copy above it is already `relative z-10`. The mask leaves the text area clear.
- [ ] **Commit:** `feat(login): dither the login screen's corner like a dot-matrix display`.

### Task 10: Docs

- [ ] docs/accessibility.md "Text-mode chrome": add the spinner (ASCII, reduced motion, label carries the status), the wordmark (`role="img"`, name MAC, pure ASCII), log tags (decorative, words unchanged), shell empties (decorative prompt) and the dither (decorative, masked away from text, dropped under forced colours). **Commit:** `docs(a11y): record phase 2's console feedback, wordmark, palettes and dither`.

### Task 11: Verification

- [ ] `npm run verify` with the E2E member, everything green.
- [ ] A one-off local axe run (not committed) over the signed-in pages for `amber`, `green` and `gruvbox`, expecting 0 violations. Record it in docs/accessibility.md.
- [ ] Screenshots of the Overview, an event and Settings in each of the five themes, plus the login screen and the sidebar wordmark at 1440px. Check Review Focus 4 and 5.
- [ ] Re-run the clipped-focus audit: 0.
