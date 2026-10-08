# Terminal UI, Phase 1 — Panels, Text Meters, Status Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app read as a terminal _application_, not only a terminal colour scheme, with three signature pieces: box-drawn panels titled in their top border, text-mode meters (`[██████░░░░]`), and a shell-prompt status line pinned to the bottom of every signed-in page.

**Architecture:** Two new presentational primitives in `components/common/` (`Panel`, `TextMeter`), each backed by a pure, unit-tested helper where there is logic (`lib/text-meter.ts`). A `StatusLine` in `components/layout/` reads the router location and the shared notification feed, which gains two fields (`syncedAt`, `stale`). Pages adopt the primitives by replacing `Card` + hand-rolled headings and the `div` progress bars. No backend, schema or API change.

**Tech Stack:** React 19, Tailwind v4 (`@theme` tokens in `frontend/src/index.css`), Radix via `radix-ui`, Vitest + Testing Library, Playwright + axe for the a11y scans.

**Spec:** Options 1–3 of the 2026-10-08 UI brainstorm (box-drawn panels with titles in the border; vim/tmux-style status line; text-mode charts). Phase 2, which is out of scope here, is options 4–5: keyboard shortcuts with `[key]` hints in the panels' bottom borders, and TUI selection (`▌` cursor, `j`/`k`). Phase 1 must not show key hints for shortcuts that do not exist yet.

## Global Constraints

- TypeScript `strict`, **no `any`** in committed code.
- Colours come only from the tokens in `frontend/src/index.css`. No `dark:` classes, no Tailwind palette colours, and no radius other than the token radii (all 0). `rounded-full` and arbitrary `rounded-[…]` are banned.
- Focus styling is the global `:focus-visible` outline. Don't add `ring-*` focus classes or `outline-none`.
- Decorative glyphs (box lines, blocks, brackets, `●`, `$`) are `aria-hidden="true"`. Every meter keeps an accessible name and value.
- Don't hand-roll an interactive widget. Everything new here is presentational, plus links and buttons that already exist.
- Motion: nothing new animates. A ticking status-line clock is a text change, not an animation.
- Files are LF, formatted by Prettier, and lint-clean (`npm run lint`, `npm run format:check`).
- Conventional Commits (commitlint), with no attribution trailers.
- After the work, record the new elements in `docs/accessibility.md` and run the signed-in axe scans (Task 6).

## Review Focus

1. **Narrow screens (375px) with long titles.** A panel title like "This Week’s Events" plus its action must truncate inside the frame, never overflow it or wrap the border line. Task 2 gives the heading `min-w-0 truncate`, and Task 6 checks it in a 375px screenshot.
2. **Meter edge values.** `max = 0`, `value > max` (over budget), negative values, and tiny non-zero values must neither throw nor mislead: an empty bar for zero, a full bar for over, and at least one cell for any non-zero amount. Pinned in Task 1's unit tests.
3. **The status line before the first read and while offline.** It must say `connecting…` before the first read and `offline · retrying` after a failed poll, never `synced NaNs ago`. Pinned in Task 5's tests.
4. **Odd paths.** A trailing slash, the root `/`, an unknown route and UUID v7 ids that share a time prefix must all give a readable prompt. The short id uses the **last** 8 hex digits, because v7 ids from the same minute share their first 8. Pinned in Task 5's `promptPath` tests.
5. **Glyph coverage on Windows.** `█` and `░` must render in the monospace stack on Windows Chrome (Consolas), not as tofu boxes. Task 6 checks this in real-browser screenshots in both themes.

---

## File Structure

| File                                                           | Responsibility                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `frontend/src/lib/text-meter.ts` (new)                         | Pure: how many cells a value fills (`meterCells`)                                    |
| `frontend/src/lib/text-meter.test.ts` (new)                    | Unit tests for the above                                                             |
| `frontend/src/components/common/text-meter.tsx` (new)          | `TextMeter`: a `role="progressbar"` drawn as `[████░░]`                              |
| `frontend/src/components/common/text-meter.test.tsx` (new)     | Accessible shape, glyph counts, tone                                                 |
| `frontend/src/components/common/panel.tsx` (new)               | `Panel`: `<section>` with its title, meta and action in a box-drawn top border       |
| `frontend/src/components/common/panel.test.tsx` (new)          | Region naming, slots, heading level                                                  |
| `frontend/src/index.css` (modify)                              | `.panel` / `.panel-rule` / `.panel-line` frame styles                                |
| `frontend/src/routes/dashboard.tsx` (+ test)                   | Widgets and stat tiles on `Panel`; Committee Load on `TextMeter`                     |
| `frontend/src/components/events/event-health-strip.tsx`        | Progress bar becomes a `TextMeter` (shared by four pages)                            |
| `frontend/src/routes/event-detail.tsx` (+ test)                | About / Event Budget cards on `Panel`                                                |
| `frontend/src/routes/finance.tsx` (+ test)                     | Money tiles and Log Expense on `Panel`; allocation `Used` column gains a `TextMeter` |
| `frontend/src/lib/prompt-path.ts` (new, + test)                | Pure: `promptPath(pathname, search)`, `syncAge(ms)`                                  |
| `frontend/src/hooks/use-now.ts` (new)                          | A `Date` that ticks once per interval                                                |
| `frontend/src/hooks/use-notifications.ts` (+ test)             | Exposes `syncedAt` and `stale`                                                       |
| `frontend/src/components/layout/status-line.tsx` (new, + test) | The prompt-style status line                                                         |
| `frontend/src/components/layout/app-shell.tsx` (+ test)        | Mounts the status line, pinned to the bottom                                         |
| `docs/accessibility.md`                                        | Records the text-mode elements                                                       |

---

### Task 1: Text meter

**Files:**

- Create: `frontend/src/lib/text-meter.ts`, `frontend/src/lib/text-meter.test.ts`
- Create: `frontend/src/components/common/text-meter.tsx`, `frontend/src/components/common/text-meter.test.tsx`

**Interfaces:**

- Produces: `meterCells(value: number, max: number, cells: number): { filled: number; empty: number }`
- Produces: `TextMeter(props: { value: number; max: number; label: string; valueText: string; cells?: number; tone?: "default" | "danger"; className?: string })`. It renders `role="progressbar"` with `aria-label={label}`, `aria-valuenow={min(value, max)}`, `aria-valuemin={0}`, `aria-valuemax={max}` and `aria-valuetext={valueText}`.

- [ ] **Step 1: Write the failing unit tests** (`frontend/src/lib/text-meter.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { meterCells } from "./text-meter";

describe("meterCells", () => {
  it("fills the share of cells the value is of max", () => {
    expect(meterCells(5, 10, 10)).toEqual({ filled: 5, empty: 5 });
    expect(meterCells(62, 100, 10)).toEqual({ filled: 6, empty: 4 });
  });

  it("draws nothing for zero, a negative value, or a max of zero", () => {
    expect(meterCells(0, 10, 10)).toEqual({ filled: 0, empty: 10 });
    expect(meterCells(-3, 10, 10)).toEqual({ filled: 0, empty: 10 });
    expect(meterCells(4, 0, 10)).toEqual({ filled: 0, empty: 10 });
  });

  it("fills every cell at or over max — over budget is a full bar, not an overflow", () => {
    expect(meterCells(10, 10, 10)).toEqual({ filled: 10, empty: 0 });
    expect(meterCells(14, 10, 10)).toEqual({ filled: 10, empty: 0 });
  });

  it("never rounds a non-zero value down to an empty bar, or a short one up to a full one", () => {
    expect(meterCells(1, 100, 10)).toEqual({ filled: 1, empty: 9 });
    expect(meterCells(99, 100, 10)).toEqual({ filled: 9, empty: 1 });
  });
});
```

- [ ] **Step 2: Run them and see them fail.** `npx vitest run frontend/src/lib/text-meter.test.ts` should fail because it cannot resolve `./text-meter`.

- [ ] **Step 3: Implement** (`frontend/src/lib/text-meter.ts`)

```ts
/**
 * How many of a meter's `cells` a value fills. Whole cells only: the exact
 * figure is always printed beside the bar, so the bar's job is the shape.
 *
 * Two rules keep the shape honest at the ends. Any non-zero value fills at
 * least one cell, so "1 open task" never draws as none. Anything short of max
 * leaves at least one cell empty, so 99% never draws as done. At or over max is
 * a full bar; the caller says "over" in words and colour.
 */
export function meterCells(
  value: number,
  max: number,
  cells: number,
): { filled: number; empty: number } {
  if (max <= 0 || value <= 0) return { filled: 0, empty: cells };
  if (value >= max) return { filled: cells, empty: 0 };
  const filled = Math.min(cells - 1, Math.max(1, Math.round((value / max) * cells)));
  return { filled, empty: cells - filled };
}
```

- [ ] **Step 4: Write the failing component test** (`frontend/src/components/common/text-meter.test.tsx`)

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TextMeter } from "./text-meter";

it("is a named progressbar whose glyphs are hidden from assistive tech", () => {
  render(
    <TextMeter value={3} max={4} label="Jordan open tasks" valueText="3 open tasks" cells={8} />,
  );

  const meter = screen.getByRole("progressbar", { name: "Jordan open tasks" });
  expect(meter).toHaveAttribute("aria-valuenow", "3");
  expect(meter).toHaveAttribute("aria-valuemax", "4");
  expect(meter).toHaveAttribute("aria-valuetext", "3 open tasks");
  expect(meter.textContent).toBe("[██████░░]");
  for (const glyphs of meter.children) expect(glyphs).toHaveAttribute("aria-hidden", "true");
});

it("clamps the reported value to max, and draws an over-max meter full in danger", () => {
  render(
    <TextMeter
      value={112}
      max={100}
      label="Budget used"
      valueText="112% used, over budget"
      tone="danger"
      cells={4}
    />,
  );

  const meter = screen.getByRole("progressbar", { name: "Budget used" });
  expect(meter).toHaveAttribute("aria-valuenow", "100");
  expect(meter.textContent).toBe("[████]");
  expect(meter.querySelector(".text-danger")).not.toBeNull();
});
```

- [ ] **Step 5: Run it and see it fail.** `npx vitest run frontend/src/components/common/text-meter.test.tsx` should fail to resolve `./text-meter`.

- [ ] **Step 6: Implement** (`frontend/src/components/common/text-meter.tsx`)

```tsx
import { meterCells } from "@/lib/text-meter";
import { cn } from "@/lib/utils";

/**
 * A progress bar drawn the way a terminal draws one: `[██████░░░░]`.
 *
 * Read-only, so `role="progressbar"` on a span is the right shape (as the
 * `div` bars it replaces were). The glyphs are decoration and hidden; the name
 * and `aria-valuetext` carry the reading. Filled cells are ink (or `--danger`),
 * the empty track is `--muted-foreground`. Both are text tokens with measured
 * contrast on `--card` and on the page (docs/accessibility.md).
 */
export function TextMeter({
  value,
  max,
  label,
  valueText,
  cells = 10,
  tone = "default",
  className,
}: {
  value: number;
  max: number;
  label: string;
  valueText: string;
  cells?: number;
  tone?: "default" | "danger";
  className?: string;
}) {
  const { filled, empty } = meterCells(value, max, cells);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.min(value, max)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={valueText}
      data-slot="text-meter"
      className={cn("inline-flex font-mono leading-none whitespace-nowrap select-none", className)}
    >
      <span aria-hidden="true" className="text-muted-foreground">
        [
      </span>
      <span aria-hidden="true" className={tone === "danger" ? "text-danger" : "text-foreground"}>
        {"█".repeat(filled)}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        {"░".repeat(empty)}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        ]
      </span>
    </span>
  );
}
```

- [ ] **Step 7: Run both test files.** `npx vitest run frontend/src/lib/text-meter.test.ts frontend/src/components/common/text-meter.test.tsx` should pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/text-meter.ts frontend/src/lib/text-meter.test.ts frontend/src/components/common/text-meter.tsx frontend/src/components/common/text-meter.test.tsx
git commit -m "feat(ui): add a text-mode meter that draws progress as [████░░]"
```

---

### Task 2: Panel frame

**Files:**

- Create: `frontend/src/components/common/panel.tsx`, `frontend/src/components/common/panel.test.tsx`
- Modify: `frontend/src/index.css`. Append a `@layer components` block after the existing `.caret` rule.

**Interfaces:**

- Produces: `Panel(props: { title: string; meta?: ReactNode; action?: ReactNode; level?: 2 | 3; className?: string; bodyClassName?: string; children: ReactNode })`. It renders `<section aria-labelledby>` (a named region) whose heading is `h2` by default.

- [ ] **Step 1: Write the failing test** (`frontend/src/components/common/panel.test.tsx`)

```tsx
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { Panel } from "./panel";

it("is a region named by its title, with meta and action in the border", () => {
  render(
    <Panel title="My Tasks" meta="3 open" action={<a href="/tasks">View All</a>}>
      <p>Body</p>
    </Panel>,
  );

  const region = screen.getByRole("region", { name: "My Tasks" });
  expect(within(region).getByRole("heading", { level: 2, name: "My Tasks" })).toBeInTheDocument();
  expect(within(region).getByText("3 open")).toBeInTheDocument();
  expect(within(region).getByRole("link", { name: "View All" })).toBeInTheDocument();
  expect(within(region).getByText("Body")).toBeInTheDocument();
});

it("takes a lower heading level where it nests under another heading", () => {
  render(
    <Panel title="Risk" level={3}>
      <p>Body</p>
    </Panel>,
  );

  expect(screen.getByRole("heading", { level: 3, name: "Risk" })).toBeInTheDocument();
});

it("hides the drawn border lines from assistive tech", () => {
  const { container } = render(<Panel title="Today">x</Panel>);

  const lines = container.querySelectorAll(".panel-line");
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const line of lines) expect(line).toHaveAttribute("aria-hidden", "true");
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run frontend/src/components/common/panel.test.tsx` should fail to resolve `./panel`.

- [ ] **Step 3: Implement the component** (`frontend/src/components/common/panel.tsx`)

```tsx
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A titled terminal box, the way lazygit and btop draw a pane:
 *
 *   ┌─ My Tasks ── 3 open ───────────── View All ─┐
 *   │ …                                            │
 *   └──────────────────────────────────────────────┘
 *
 * The title, meta and action sit IN the top border row; `.panel::before` draws
 * the sides, bottom and surface from that row's midline down (index.css). The
 * lines are hairlines (`--border`), which group content and so fall outside
 * 1.4.11, as the cards they replace did. The heading names the region.
 *
 * `action` is for a link or button that already exists on the page. Phase 2
 * adds `[key]` hints in the bottom border, once shortcuts exist to hint at.
 */
export function Panel({
  title,
  meta,
  action,
  level = 2,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={id} data-slot="panel" className={cn("panel", className)}>
      <div className="panel-rule">
        <span aria-hidden="true" className="panel-line w-3 shrink-0" />
        <Heading id={id} className="min-w-0 truncate px-1.5 font-display text-sm leading-none">
          {title}
        </Heading>
        {meta !== undefined && (
          <span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">{meta}</span>
        )}
        <span aria-hidden="true" className="panel-line min-w-3 flex-1" />
        {action && <span className="shrink-0 px-1.5 text-xs">{action}</span>}
        <span aria-hidden="true" className="panel-line w-3 shrink-0" />
      </div>
      <div className={cn("px-4 pt-2 pb-4", bodyClassName)}>{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Add the frame CSS** (append to `frontend/src/index.css`)

```css
/* The `Panel` frame (components/common/panel.tsx): a box whose top border is a
   row of content. The row is `--panel-rule` tall; its lines and the box's sides
   start at the row's midline, so the corners meet and the title sits IN the
   border, as a TUI draws it. The surface starts at that midline too, so the
   title straddles the page and the panel the way a terminal legend does. */
@layer components {
  .panel {
    --panel-rule: 1.5rem;
    position: relative;
    isolation: isolate;
  }
  .panel::before {
    content: "";
    position: absolute;
    inset: calc(var(--panel-rule) / 2) 0 0;
    z-index: -1;
    border: 1px solid var(--border);
    border-top: 0;
    background: var(--card);
  }
  .panel-rule {
    display: flex;
    align-items: center;
    height: var(--panel-rule);
  }
  .panel-line {
    align-self: flex-start;
    height: 1px;
    margin-top: calc(var(--panel-rule) / 2);
    background: var(--border);
  }
}
```

- [ ] **Step 5: Run the tests.** `npx vitest run frontend/src/components/common/panel.test.tsx` should pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/common/panel.tsx frontend/src/components/common/panel.test.tsx frontend/src/index.css
git commit -m "feat(ui): add a box-drawn panel titled in its top border"
```

---

### Task 3: Overview on panels and meters

**Files:**

- Modify: `frontend/src/routes/dashboard.tsx`. The five `Card` + `SectionHeading` widgets (My Tasks, This Week’s Events, Today, Recent Activity, Committee Load), the four `Metric` tiles, and the Committee Load bars.
- Test: `frontend/src/routes/dashboard.test.tsx`

**Interfaces:**

- Consumes: `Panel` (Task 2) and `TextMeter` (Task 1).

- [ ] **Step 1: Write the failing test** (add to `dashboard.test.tsx`, reusing its `stubFetch` and `renderPage` helpers and the fixtures from the first test)

```tsx
it("frames each widget as a titled panel with its link in the border", async () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  stubFetch({
    tasks: { tasks: [task(tomorrow)] },
    events: { items: [event(tomorrow)], nextCursor: null },
    notifications: { notifications: [], unreadCount: 0 },
    members: { members: [rosterMember()] },
  });

  renderPage();

  const myTasks = await screen.findByRole("region", { name: "My Tasks" });
  expect(within(myTasks).getByRole("link", { name: /view all/i })).toHaveAttribute(
    "href",
    "/tasks?scope=mine",
  );
  for (const name of [
    "This Week’s Events",
    "Today",
    "Recent Activity",
    "Committee Load",
    "My Open Tasks",
  ]) {
    expect(screen.getByRole("region", { name })).toBeInTheDocument();
  }
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run frontend/src/routes/dashboard.test.tsx -t "titled panel"` should fail because there is no region named "My Tasks".

- [ ] **Step 3: Implement.**
  - Replace each `<Card className="gap-0 py-0 shadow-none"><SectionHeading title=… to=… action=… /><CardContent …>BODY</CardContent>…</Card>` with `<Panel title=… action={<PanelLink to=…>{action}</PanelLink>}>BODY</Panel>`.
  - Keep each body's inner markup unchanged. Move the "N more open tasks" footer inside the body as a last `div` with `border-t pt-2.5`.
  - Delete `SectionHeading`. Add this beside the other helpers in the file:

```tsx
/** The link a panel carries in its border: "View All ›". */
function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
    >
      {children}
      <ChevronRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}
```

- Rewrite `Metric` on `Panel`, keeping its props and the `value === undefined` "unavailable" text:

```tsx
function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value?: number;
  detail: string;
  tone?: "danger";
}) {
  return (
    <Panel title={label} bodyClassName="grid gap-1 px-4 pt-1 pb-3">
      <p
        className={cn(
          "text-3xl font-semibold tracking-[-0.04em] tabular-nums",
          tone === "danger" && "text-destructive",
        )}
      >
        {value ?? "—"}
        {value === undefined && <span className="sr-only">unavailable</span>}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Panel>
  );
}
```

- Replace the Committee Load `div role="progressbar"` and its inner bar with the following, keeping the existing name and value text so the current tests still pass:

```tsx
<TextMeter
  value={count}
  max={maxLoad}
  cells={12}
  label={`${name} open tasks`}
  valueText={`${count} open task${count === 1 ? "" : "s"}`}
  className="mt-1.5 text-xs"
/>
```

- Imports: add `Panel`, `TextMeter`, `ReactNode` and `cn`. Drop `Card` and `CardContent` if nothing else in the file uses them (check with grep).

- [ ] **Step 4: Run the Overview tests.** `npx vitest run frontend/src/routes/dashboard.test.tsx` should pass in full, including the existing "Jordan Lee open tasks" progressbar assertions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/dashboard.tsx frontend/src/routes/dashboard.test.tsx
git commit -m "feat(dashboard): draw the Overview's widgets as titled panels and text meters"
```

---

### Task 4: Event pages and Finance

**Files:**

- Modify: `frontend/src/components/events/event-health-strip.tsx`. The `div` bar becomes a `TextMeter`. It is shared by the Overview, Events, Calendar and the event page.
- Modify: `frontend/src/routes/event-detail.tsx`. The About and Event Budget cards become `Panel`s.
- Modify: `frontend/src/routes/finance.tsx`. `MoneyCard` and Log Expense become `Panel`s, and `AllocationRow` gains a meter.
- Test: `frontend/src/routes/event-detail.test.tsx`, `frontend/src/routes/finance.test.tsx`

**Interfaces:**

- Consumes: `Panel` and `TextMeter`.

- [ ] **Step 1: Write the failing tests**

In `event-detail.test.tsx` (reuse `stubEvent` and `renderDetail`):

```tsx
it("frames the overview in titled panels", async () => {
  stubEvent();
  renderDetail();

  expect(await screen.findByRole("region", { name: "About" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Event Budget" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Tasks complete" })).toHaveTextContent(/\[█*░*\]/);
});
```

In `finance.test.tsx`, the default `budget()` fixture already carries a "Semester Hackathon" allocation at 120% used:

```tsx
it("draws each event's budget use as a meter, over budget in words", async () => {
  stubFetch({});
  renderPage();

  const meter = await screen.findByRole("progressbar", { name: "Semester Hackathon budget used" });
  expect(meter).toHaveAttribute("aria-valuenow", "100");
  expect(meter).toHaveAttribute("aria-valuetext", "120% used, over budget");
});
```

Also update the existing "renders the budget fields the endpoint returns" test. It finds the Available amount through `screen.getByText("Available").parentElement`, and once the label is a panel's border title the amount is no longer in that parent. Scope it to the region instead:

```tsx
await waitFor(() => expect(screen.getByRole("region", { name: "Available" })).toBeInTheDocument());
expect(
  within(screen.getByRole("region", { name: "Available" })).getByText("$50.00"),
).toBeInTheDocument();
```

- [ ] **Step 2: Run them and see them fail.** `npx vitest run frontend/src/routes/event-detail.test.tsx frontend/src/routes/finance.test.tsx` should fail on the two new tests.

- [ ] **Step 3: Implement.**
  - `EventHealthStrip`: replace the `div role="progressbar"` and its inner bar with:

```tsx
<TextMeter
  value={percentComplete}
  max={100}
  label={subject ? `${subject} tasks complete` : "Tasks complete"}
  valueText={`${percentComplete}% complete`}
/>
```

    Update the component's doc comment, which describes the shape as a "`div` with `role=progressbar`".

- `event-detail.tsx`: About becomes `<Panel title="About">…same body…</Panel>`. Event Budget becomes `<Panel title="Event Budget" bodyClassName="grid gap-3 px-4 pt-2 pb-4 text-sm">…the three BudgetRows…</Panel>`, dropping the decorative `CircleDollarSign` from its heading (and the import, if now unused).
- `finance.tsx`, `MoneyCard`: becomes a `Panel` titled `label`, with the download button (when `onDownload` is given) as its `action`. The body is the amount. The decorative icon tile is dropped, because the border title now does that job. Log Expense becomes `<Panel title="Log Expense" className="mt-10">…the form…</Panel>`. Its title is now a real `h2`; before, it was a `div`.
- `finance.tsx`, `AllocationRow`: in the `Used` cell, render the percentage and a meter:

```tsx
<span className="inline-flex items-center justify-end gap-2">
  <TextMeter
    value={Math.round(used * 100)}
    max={100}
    cells={8}
    label={`${row.eventTitle} budget used`}
    valueText={`${Math.round(used * 100)}% used${used > 1 ? ", over budget" : ""}`}
    tone={used > 1 ? "danger" : "default"}
    className="hidden text-xs sm:inline-flex"
  />
  <span className={used > 1 ? "font-medium text-destructive" : undefined}>
    {Math.round(used * 100)}%{used > 1 && <span className="sr-only"> — over budget</span>}
  </span>
</span>
```

- [ ] **Step 4: Run every suite that renders these components.** `npx vitest run frontend/src/routes/event-detail.test.tsx frontend/src/routes/finance.test.tsx frontend/src/routes/events.test.tsx frontend/src/routes/calendar.test.tsx frontend/src/routes/dashboard.test.tsx` should all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/events/event-health-strip.tsx frontend/src/routes/event-detail.tsx frontend/src/routes/event-detail.test.tsx frontend/src/routes/finance.tsx frontend/src/routes/finance.test.tsx
git commit -m "feat(ui): put event pages and Finance on panels and text meters"
```

---

### Task 5: Status line

**Files:**

- Create: `frontend/src/lib/prompt-path.ts`, `frontend/src/lib/prompt-path.test.ts`
- Create: `frontend/src/hooks/use-now.ts`
- Modify: `frontend/src/hooks/use-notifications.ts`; Create: `frontend/src/hooks/use-notifications.test.ts`
- Create: `frontend/src/components/layout/status-line.tsx`, `frontend/src/components/layout/status-line.test.tsx`
- Modify: `frontend/src/components/layout/app-shell.tsx`, `frontend/src/components/layout/app-shell.test.tsx` (the fake feed gains `syncedAt` and `stale`)

**Interfaces:**

- Produces: `promptPath(pathname: string, search: string): string` and `syncAge(ms: number): string`.
- Produces: `useNow(intervalMs?: number): Date`.
- Produces: `useNotificationsSource()` additionally returns `syncedAt: Date | undefined` and `stale: boolean`.
- Produces: `StatusLine(props: { member: AuthUser })`.

- [ ] **Step 1: Write the failing pure tests** (`frontend/src/lib/prompt-path.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { promptPath, syncAge } from "./prompt-path";

const id = "018f3a4b-0000-7000-8000-00000000a1b2";

describe("promptPath", () => {
  it("is ~ at the root, and the path below it elsewhere", () => {
    expect(promptPath("/", "")).toBe("~");
    expect(promptPath("/events", "")).toBe("~/events");
    expect(promptPath("/events/", "")).toBe("~/events");
  });

  it("shortens an id to its last eight digits — v7 ids from one minute share their first eight", () => {
    expect(promptPath(`/events/${id}`, "")).toBe("~/events/0000a1b2");
  });

  it("walks into the open tab and the open thread, and ignores other parameters", () => {
    expect(promptPath(`/events/${id}`, "?tab=thread")).toBe("~/events/0000a1b2/thread");
    expect(promptPath("/messages", `?thread=${id}`)).toBe("~/messages/0000a1b2");
    expect(promptPath("/tasks", "?scope=mine")).toBe("~/tasks");
  });
});

describe("syncAge", () => {
  it.each([
    [400, "just now"],
    [1_000, "1s ago"],
    [59_999, "59s ago"],
    [60_000, "1m ago"],
    [3_600_000, "1h ago"],
  ])("%ims → %s", (ms, text) => {
    expect(syncAge(ms)).toBe(text);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** `npx vitest run frontend/src/lib/prompt-path.test.ts` should fail to resolve the module.

- [ ] **Step 3: Implement** (`frontend/src/lib/prompt-path.ts`)

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The last eight hex digits: the random end of a v7 id, so two ids minted in
 * the same minute — which share their first eight — still read apart. */
function short(segment: string): string {
  return UUID.test(segment) ? segment.replaceAll("-", "").slice(-8) : segment;
}

/**
 * Where the reader is, as a shell would print it: `~/events/0000a1b2/thread`.
 * The route's own path, plus the two query parameters that pick what is on
 * screen (`tab` on an event, `thread` on Messages). Everything else in the
 * query is a filter, not a place.
 */
export function promptPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean).map(short);
  for (const key of ["tab", "thread"]) {
    const value = params.get(key);
    if (value) segments.push(short(value));
  }
  return segments.length === 0 ? "~" : `~/${segments.join("/")}`;
}

/** How long ago a read landed, at the grain a status line needs. */
export function syncAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
```

- [ ] **Step 4: Run the tests.** They should pass.

- [ ] **Step 5: Write the failing hook test** (`frontend/src/hooks/use-notifications.test.ts`)

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useNotificationsSource } from "./use-notifications";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("stamps each landed read, and says so when the feed cannot be reached", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ notifications: [], unreadCount: 0 }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useNotificationsSource());
  expect(result.current.syncedAt).toBeUndefined();
  await waitFor(() => expect(result.current.syncedAt).toBeInstanceOf(Date));
  expect(result.current.stale).toBe(false);

  fetchMock.mockImplementation(async () => {
    throw new Error("offline");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(result.current.stale).toBe(true);
});
```

- [ ] **Step 6: Run it and see it fail.** `npx vitest run frontend/src/hooks/use-notifications.test.ts` should fail because `syncedAt` is undefined forever.

- [ ] **Step 7: Implement in `use-notifications.ts`.**
  - Add the state: `const [syncedAt, setSyncedAt] = useState<Date>(); const [stale, setStale] = useState(false);`
  - In `reload`'s success `.then((page) => …)`, at the top, before the write/mount guard returns: `if (mounted.current) { setSyncedAt(new Date()); setStale(false); }`. A read that was dropped because a mark overlapped it still proves the feed is reachable.
  - In `.catch`, after the mount check: `setStale(true);`
  - Return `syncedAt` and `stale` alongside the existing fields.
  - In `app-shell.test.tsx`, add `syncedAt: undefined, stale: false` to `feed()`.

- [ ] **Step 8: Run the hook test and the Inbox tests.** `npx vitest run frontend/src/hooks/use-notifications.test.ts frontend/src/routes/notifications.test.tsx` should pass.

- [ ] **Step 9: Write `useNow`** (`frontend/src/hooks/use-now.ts`)

```ts
import { useEffect, useState } from "react";

/** The current time, re-read every `intervalMs` — for text that ages ("2s ago"). */
export function useNow(intervalMs = 1_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 10: Write the failing component test** (`frontend/src/components/layout/status-line.test.tsx`)

```tsx
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { StatusLine } from "./status-line";
import { NotificationsProvider, type NotificationsValue } from "@/hooks/use-notifications";

const member = {
  id: "019ff060-2362-7399-9032-b4bbcc3a25d5",
  email: "jordan.lee@example.com",
  role: "officer",
  tier: 0,
} as const;

function feed(overrides: Partial<NotificationsValue>): NotificationsValue {
  return {
    state: { status: "ok", items: [], unreadCount: 3, loaded: 0, hasMore: false },
    loadingMore: false,
    mutationError: undefined,
    syncedAt: undefined,
    stale: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    ...overrides,
  };
}

function renderLine(
  value: NotificationsValue,
  path = "/events/018f3a4b-0000-7000-8000-00000000a1b2?tab=thread",
) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <NotificationsProvider value={value}>
        <StatusLine member={member} />
      </NotificationsProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.useRealTimers());

it("prints a prompt for the page, the unread count, and how fresh the feed is", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderLine(feed({ syncedAt: new Date(Date.now() - 3_000) }));

  const line = screen.getByRole("contentinfo", { name: "Status line" });
  expect(line).toHaveTextContent("jordan.lee@mac:~/events/0000a1b2/thread$");
  expect(screen.getByRole("link", { name: /3 unread/ })).toHaveAttribute("href", "/notifications");
  expect(line).toHaveTextContent("synced 3s ago");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(line).toHaveTextContent("synced 4s ago");
});

it("says connecting before the first read, and offline when the feed fails", () => {
  const { rerender } = renderLine(feed({}));
  expect(screen.getByRole("contentinfo")).toHaveTextContent("connecting…");

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NotificationsProvider value={feed({ syncedAt: new Date(), stale: true })}>
        <StatusLine member={member} />
      </NotificationsProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("contentinfo")).toHaveTextContent("offline · retrying");
});
```

- [ ] **Step 11: Run it and see it fail.** `npx vitest run frontend/src/components/layout/status-line.test.tsx` should fail to resolve `./status-line`.

- [ ] **Step 12: Implement** (`frontend/src/components/layout/status-line.tsx`)

```tsx
import type { AuthUser } from "@ctp/shared";
import { Link, useLocation } from "react-router-dom";
import { useNotifications } from "@/hooks/use-notifications";
import { useNow } from "@/hooks/use-now";
import { promptPath, syncAge } from "@/lib/prompt-path";
import { cn } from "@/lib/utils";

/**
 * The shell prompt and modeline, pinned to the bottom of every signed-in page:
 *
 *   jordan.lee@mac:~/events/0000a1b2/thread$        ● 3 unread · synced 2s ago
 *
 * Deliberately NOT a live region: the age ticks every second, and a status line
 * that announced itself each tick would drown everything else. The unread count
 * is a link to the Inbox, and the sidebar badge already announces it in the nav.
 */
export function StatusLine({ member }: { member: AuthUser }) {
  const location = useLocation();
  const notifications = useNotifications();
  const now = useNow();
  const unread = notifications.state.status === "ok" ? notifications.state.unreadCount : 0;
  const user = member.email.split("@")[0];

  return (
    <footer
      aria-label="Status line"
      className="sticky bottom-0 z-30 flex h-7 items-center gap-4 border-t bg-card px-4 font-mono text-xs"
    >
      <p className="min-w-0 truncate">
        <span className="hidden text-muted-foreground sm:inline">{user}@mac:</span>
        <span>{promptPath(location.pathname, location.search)}</span>
        <span aria-hidden="true" className="text-ring">
          $
        </span>
      </p>
      <p className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
        <Link to="/notifications" className="hover:text-foreground">
          <span aria-hidden="true" className={cn(unread > 0 && "text-ring")}>
            ●{" "}
          </span>
          {unread} unread
        </Link>
        <span aria-hidden="true">·</span>
        {notifications.stale ? (
          <span className="text-danger">offline · retrying</span>
        ) : notifications.syncedAt ? (
          <span>synced {syncAge(now.getTime() - notifications.syncedAt.getTime())}</span>
        ) : (
          <span>connecting…</span>
        )}
      </p>
    </footer>
  );
}
```

- [ ] **Step 13: Mount it in `app-shell.tsx`.** Make the content column a full-height flex column, so the line stays at the bottom on short pages and sticks there on long ones:

```tsx
<div className="flex min-h-svh min-w-0 flex-col">
  {/* mobile header and mobile nav, unchanged */}
  <div id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
    {children}
  </div>
  <StatusLine member={member} />
</div>
```

Then add a test to `app-shell.test.tsx`: `renderShell(4)` should give a contentinfo landmark named "Status line" containing "4 unread".

- [ ] **Step 14: Run the layout, hook and Inbox suites.** `npx vitest run frontend/src/components/layout frontend/src/lib/prompt-path.test.ts frontend/src/hooks/use-notifications.test.ts frontend/src/routes/notifications.test.tsx` should pass.

- [ ] **Step 15: Commit**

```bash
git add frontend/src/lib/prompt-path.ts frontend/src/lib/prompt-path.test.ts frontend/src/hooks/use-now.ts frontend/src/hooks/use-notifications.ts frontend/src/hooks/use-notifications.test.ts frontend/src/components/layout/status-line.tsx frontend/src/components/layout/status-line.test.tsx frontend/src/components/layout/app-shell.tsx frontend/src/components/layout/app-shell.test.tsx
git commit -m "feat(layout): pin a shell-prompt status line to the bottom of the app"
```

---

### Task 6: Accessibility record and verification

**Files:**

- Modify: `docs/accessibility.md`. Add a `## Text-mode chrome` section before `## ⚠️ Re-run this after any palette change`.

- [ ] **Step 1: Document** the three elements in `docs/accessibility.md`:
  - **Meters.** `role="progressbar"` with a name and `aria-valuetext`; the glyphs are `aria-hidden`; the value is clamped to max, with "over budget" in words. Filled cells are `--foreground` or `--danger` and the track is `--muted-foreground`, all text tokens already in the contrast table.
  - **Panels.** Each is a `section` named by its `h2`/`h3`, so it's a region. Its lines are `--border` hairlines that group content, outside 1.4.11, the same as the cards they replace.
  - **Status line.** A `footer` named "Status line" (a contentinfo landmark), deliberately not live. Its text is `--foreground`/`--muted-foreground` on `--card`, the offline notice is `--danger`, and the `$` and `●` glyphs are `--ring` and decorative.
- [ ] **Step 2: Run the whole suite.** `npm run typecheck && npm run lint && npm run format:check && npm run test:unit && npm run test:integration` should all pass.
- [ ] **Step 3: Signed-in axe scans** (local only; nothing committed):
  1. Set `DEV_PASSWORD_AUTH=1` in the root `.env`.
  2. Run `npm run dev`.
  3. Create an account at `http://localhost:5173/scratch`.
  4. Give it an officer membership with `npm run db:dev-member -- <email> officer`.
  5. Run `E2E_MEMBER_EMAIL=<email> E2E_MEMBER_PASSWORD=<pw> npx playwright test e2e/a11y.spec.ts`. Expect 0 violations.
- [ ] **Step 4: Screenshots.** Overview, an event page, Finance and Members, in light and dark, at 1440px and 375px. Check the Review Focus items: titles truncate inside their frames, `█`/`░` render on Windows, and corners meet.
- [ ] **Step 5: Commit**

```bash
git add docs/accessibility.md
git commit -m "docs(a11y): record the text-mode panels, meters and status line"
```

## Phase 2 (not in this plan)

- Keyboard layer: `g e` / `g t` navigation, `n` new, `/` filter, a `?` help overlay, with a Settings toggle to turn single-key shortcuts off (WCAG 2.1.4). Panels then gain a bottom border carrying `[key]` hints.
- TUI selection: an inverse-video selected row with a `▌` cursor and `j`/`k` movement on the Inbox, the task list and Messages.
