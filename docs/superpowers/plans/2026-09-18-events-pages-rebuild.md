# Events List + Event Detail Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/events` and `/events/:id` up to PRD R4 — server-side filters and
cursor pagination on the list, a tabbed detail page carrying the risk verdict from
the already-built (and currently unused) `GET /api/events/:id/progress`, plus the
tier-gated create and president-only cancel actions.

**Architecture:** No new backend work — every endpoint this plan consumes already
ships. Data-fetching stays in `frontend/src/hooks/` (MVVM); `routes/` components
stay declarative. The two hooks that grow (`use-events`, `use-event`) converge on
the house ViewModel shape the rest of the app already uses — an object with
`.state` plus mutation callbacks, as in `use-members` and `use-notifications` —
rather than returning a bare state union.

**Tech Stack:** TypeScript (strict, no `any`), React 19, Vite, react-router-dom,
Tailwind v4 (`@theme` CSS variables), shadcn/Radix (`radix-ui` package), zod v4
via `@ctp/shared`, Vitest + Testing Library, Playwright + axe.

**Spec:** No separate spec file. Scope was agreed in conversation on 2026-09-18
and is recorded in _Design decisions_ below. Background: `docs/prd.md` (R4, R5,
R8, R9), `docs/api-endpoints.md` (Events section), `CLAUDE.md` (shadcn-first,
ViewModel layer, stub markers).

## Global Constraints

- TypeScript `strict: true`; **no `any`** in committed code.
- Domain shapes live only in `shared/`; the frontend imports them from `@ctp/shared`.
- **`frontend/` never imports `backend/`.** Types cross only via `@ctp/shared`.
- **shadcn-first.** Prefer a shadcn/Radix component over a hand-rolled one. A
  hand-rolled interactive element must justify itself and add keyboard handling.
- **ViewModel layer:** fetching/state lives in `frontend/src/hooks/`; `routes/`
  components stay declarative.
- **Stub markers:** unfinished logic carries `TODO(Rn)` naming its requirement.
- **Colours are CSS variables only** — no literal hex. `TODO(theme)` (the MAC
  palette swap) is out of scope; do not touch `frontend/src/index.css`.
- **`res.ok` is checked BEFORE `res.json()`** in every fetch. See decision 1.
- House copy, verbatim: loading is `Loading <Title Case Noun>…` (real ellipsis
  character) with `role="status"`; errors are
  `Couldn't load <thing>: {message}. Refresh the page to try again.` with
  `role="alert"`; mutation errors append `. Try again.`
- House classes: page shell `mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10`;
  every `<Card>` carries `shadow-none`; empty states are
  `border-dashed` + `py-12 text-center text-sm text-muted-foreground`.
- Must pass: `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run test:unit`. The e2e axe scan (`e2e/a11y.spec.ts`) must stay green.

## Design decisions

1. **`use-event.ts` has the bug `0752ade` just fixed next door.** It calls
   `res.json()` before checking `res.ok`, so an HTML error page surfaces a raw
   `SyntaxError: Unexpected token '<'` instead of the house message. Task 1 applies
   the same swap the teammate applied to `use-events.ts`, with the matching test.
2. **Radix Tabs, styled as the house segmented control.** `notifications.tsx:52`
   hand-rolls a segmented control from `aria-pressed` buttons. That is right for a
   two-way filter and wrong for a five-panel tabset, which needs `role="tablist"`,
   roving tabindex and arrow-key nav. `radix-ui` is already a dependency, and
   CLAUDE.md says shadcn-first — so Task 2 wraps Radix Tabs and gives it the exact
   classes of the existing control (`rounded-lg bg-secondary p-1`, active
   `bg-card text-foreground shadow-sm`). Same look, correct mechanics.
3. **Tab state lives in the URL** (`?tab=overview`), via `useSearchParams`, so tabs
   deep-link and the browser Back button steps through them.
4. **The Thread tab forces `?include=tasks,channel`.** `channelId` is populated
   only when `include=channel` is passed (`backend/src/routes/events/events.ts:389`).
   This **changes the URL assertion at `event-detail.test.tsx:64`**, which currently
   pins `?include=tasks`. That assertion is updated, not deleted — it still pins an
   exact URL, just the new one. Called out because it is an existing test changing
   under a feature, not a flake.
5. **Time filtering is server-side, and the list is not grouped.** `GET /api/events`
   sorts `startsAt DESC`, so a client-side Upcoming/Past split would show groups that
   are partial until you page to the bottom. Instead the segmented control maps to
   real query params: Upcoming → `from=<now>`, Past → `to=<now>`, All → neither.
6. **`cancelled` is an explicit opt-in.** The API excludes cancelled events unless
   `?status=cancelled` is passed, so it is an ordinary option in the status
   `<select>` rather than a separate toggle.
7. **RSVPs and Files cannot be built.** `grep -ri rsvp` over the repo returns two
   hits, both aspirational lines in `docs/prd.md`; there is no schema, no table and
   no endpoint. Files is R11, Deferred. Both tabs ship as empty states carrying
   `TODO(R4)` / `TODO(R11)` per the stub-marker convention.
8. **Create takes only what `createEventSchema` requires**, plus venue — title and
   `startsAt` are the sole required fields. Everything else (description,
   attendance, allocation) is a later `PATCH` and is out of scope here.
9. **`useEvents` and `useEvent` change return shape** from a bare state union to
   `{ state, … }`, matching `useTasks`/`useMembers`/`useNotifications`. Their only
   callers are the two pages in this plan.

## File structure

| File                                            | Responsibility                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `frontend/src/components/ui/tabs.tsx`           | **Create.** Radix Tabs wrapper in house segmented-control clothing.                      |
| `frontend/src/hooks/use-event-progress.ts`      | **Create.** ViewModel for `GET /api/events/:id/progress`.                                |
| `frontend/src/components/event-risk-panel.tsx`  | **Create.** Renders an `EventProgress` — risk badge, percent, days until, burn, reasons. |
| `frontend/src/components/event-task-board.tsx`  | **Create.** The four-column board, extracted from `event-detail.tsx`.                    |
| `frontend/src/components/event-filters.tsx`     | **Create.** Time segmented control + status select for the list.                         |
| `frontend/src/components/create-event-form.tsx` | **Create.** Tier-1+ inline create card.                                                  |
| `frontend/src/hooks/use-events.ts`              | **Modify.** Add `from`/`to`/`ownerId`, `loadMore` on `nextCursor`, `createEvent`.        |
| `frontend/src/hooks/use-event.ts`               | **Modify.** Fix ok-before-json; `include=tasks,channel`; add `cancelEvent`.              |
| `frontend/src/routes/events.tsx`                | **Modify.** Wire filters, Load more, create.                                             |
| `frontend/src/routes/event-detail.tsx`          | **Modify.** Tabbed shell; delegate to the new components.                                |
| `frontend/src/routes/events.test.tsx`           | **Modify.** Keep the `0752ade` error test; add filter/pagination/create tests.           |
| `frontend/src/routes/event-detail.test.tsx`     | **Modify.** Update the URL assertion (decision 4); add tab/risk/cancel tests.            |

---

### Task 1: Fix the ok-before-json bug in `use-event.ts`

Mirrors commit `0752ade`, which fixed exactly this in `use-events.ts`.

**Files:**

- Modify: `frontend/src/hooks/use-event.ts:24-27`
- Test: `frontend/src/routes/event-detail.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: no signature change. `useEvent(id)` still returns the same state union;
  Task 6 changes its shape.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("EventDetailPage", …)` block:

```tsx
it("shows an actionable error when the API returns an HTML error page", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    }),
  );

  render(
    <MemoryRouter initialEntries={["/events/018f3a4b-0000-7000-8000-000000000001"]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't load the event: Failed to load event. Refresh the page to try again.",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/routes/event-detail.test.tsx`
Expected: FAIL — the alert carries the raw `SyntaxError` text, not `Failed to load event`.

- [ ] **Step 3: Swap the two lines**

In `frontend/src/hooks/use-event.ts`, inside the `.then(async (res) => {` block, change:

```ts
if (res.status === 404) return { status: "not_found" as const };
const body: unknown = await res.json();
if (!res.ok) throw new Error("Failed to load event");
const parsed = eventResponseSchema.parse(body);
```

to:

```ts
if (res.status === 404) return { status: "not_found" as const };
if (!res.ok) throw new Error("Failed to load event");
const parsed = eventResponseSchema.parse(await res.json());
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/routes/event-detail.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/use-event.ts frontend/src/routes/event-detail.test.tsx
git commit -m "fix(events): check res.ok before parsing event JSON"
```

---

### Task 2: `ui/tabs.tsx` — Radix Tabs in house clothing

**Files:**

- Create: `frontend/src/components/ui/tabs.tsx`
- Test: `frontend/src/components/ui/tabs.test.tsx`

**Interfaces:**

- Consumes: `cn` from `@/lib/utils`; the `radix-ui` package.
- Produces: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`. `Tabs` accepts Radix
  `Root` props — `value`, `onValueChange`, `defaultValue`. Task 6 drives it as a
  controlled component from `useSearchParams`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

describe("Tabs", () => {
  function renderTabs() {
    return render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>,
    );
  }

  it("exposes tablist semantics the hand-rolled control cannot", () => {
    renderTabs();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("First panel");
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Second panel");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/components/ui/tabs.test.tsx`
Expected: FAIL — `Failed to resolve import "./tabs"`.

**`@testing-library/user-event` is not installed** — `node_modules/@testing-library/`
holds only `dom`, `jest-dom` and `react`. Install it before this step; Tasks 4–8
all depend on it too:

```bash
npm i -D @testing-library/user-event --workspace @ctp/frontend
```

Commit the lockfile change with this task.

- [ ] **Step 3: Write the component**

Classes are copied from the segmented control at `frontend/src/routes/notifications.tsx:52-67`
so the two controls look identical; `data-[state=active]` replaces `aria-pressed`.

```tsx
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-6", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex gap-1 overflow-x-auto rounded-lg bg-secondary p-1", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/components/ui/tabs.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/tabs.tsx frontend/src/components/ui/tabs.test.tsx
git commit -m "feat(frontend): add tabs primitive"
```

---

### Task 3: `use-event-progress.ts` + the risk panel

Wires `GET /api/events/:id/progress`, which ships at
`backend/src/routes/events/events.ts:322` and has no frontend caller today.

**Files:**

- Create: `frontend/src/hooks/use-event-progress.ts`
- Create: `frontend/src/components/event-risk-panel.tsx`
- Test: `frontend/src/components/event-risk-panel.test.tsx`

**Interfaces:**

- Consumes: `eventProgressSchema`, `type EventProgress` from `@ctp/shared`;
  `StatusBadge`, which already renders `on_track` / `at_risk` / `critical`
  (`frontend/src/components/status-badge.tsx:21-23`).
- Produces:
  - `useEventProgress(id: string | undefined): ProgressState`, where `ProgressState` is
    `{ status: "loading" } | { status: "ok"; progress: EventProgress } | { status: "error"; message: string }`
  - `<EventRiskPanel progress={EventProgress} />`

  Task 6 renders both on the Overview tab.

- [ ] **Step 1: Write the failing test**

```tsx
import type { EventProgress } from "@ctp/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventRiskPanel } from "./event-risk-panel";

const progress: EventProgress = {
  percentComplete: 33,
  overdueCount: 1,
  daysUntil: 15,
  budgetBurn: 0.24,
  risk: "at_risk",
  riskReasons: ["1 overdue task"],
};

describe("EventRiskPanel", () => {
  it("renders the verdict, the headline numbers and the reasons", () => {
    render(<EventRiskPanel progress={progress} />);

    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getByText("15 days")).toBeInTheDocument();
    expect(screen.getByText("24%")).toBeInTheDocument();
    expect(screen.getByText("1 overdue task")).toBeInTheDocument();
  });

  it("reads an unallocated budget as no burn rather than zero", () => {
    render(<EventRiskPanel progress={{ ...progress, budgetBurn: null }} />);

    expect(screen.getByText("Not allocated")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("says the event has passed once daysUntil is negative", () => {
    render(<EventRiskPanel progress={{ ...progress, daysUntil: -3 }} />);

    expect(screen.getByText("3 days ago")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/components/event-risk-panel.test.tsx`
Expected: FAIL — `Failed to resolve import "./event-risk-panel"`.

- [ ] **Step 3: Write the hook**

`frontend/src/hooks/use-event-progress.ts` — note `res.ok` before `res.json()`:

```ts
import { eventProgressSchema, type EventProgress } from "@ctp/shared";
import { useEffect, useState } from "react";

type ProgressState =
  | { status: "loading" }
  | { status: "ok"; progress: EventProgress }
  | { status: "error"; message: string };

/**
 * ViewModel for `GET /api/events/:id/progress`. Kept apart from `useEvent` on
 * purpose: the verdict needs `daysUntil` in the club timezone, which only this
 * endpoint computes, and a second hook leaves the detail fetch's URL alone.
 */
export function useEventProgress(id: string | undefined): ProgressState {
  const [state, setState] = useState<ProgressState>({ status: "loading" });

  useEffect(() => {
    if (!id) return;
    let active = true;
    setState({ status: "loading" });

    fetch(`/api/events/${id}/progress`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load progress");
        return eventProgressSchema.parse(await res.json());
      })
      .then((progress) => {
        if (active) setState({ status: "ok", progress });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load progress",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  return state;
}
```

- [ ] **Step 4: Write the panel**

`frontend/src/components/event-risk-panel.tsx`:

```tsx
import type { EventProgress } from "@ctp/shared";
import { StatusBadge } from "@/components/status-badge";

/** The verdict from `/progress`. A read-only readout, so no keyboard handling. */
export function EventRiskPanel({ progress }: { progress: EventProgress }) {
  const { percentComplete, daysUntil, budgetBurn, risk, riskReasons } = progress;

  return (
    <div data-slot="event-risk-panel">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Risk</h3>
        <StatusBadge status={risk} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-4">
        <Metric label="Complete" value={`${percentComplete}%`} />
        <Metric label="Timing" value={countdown(daysUntil)} />
        <Metric
          label="Budget burn"
          value={budgetBurn === null ? "Not allocated" : `${Math.round(budgetBurn * 100)}%`}
        />
      </dl>
      {riskReasons.length > 0 && (
        <ul className="mt-4 grid gap-1.5 border-t pt-4 text-sm text-muted-foreground">
          {riskReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** `daysUntil` is negative once the event has passed (club timezone, not UTC). */
function countdown(daysUntil: number) {
  if (daysUntil === 0) return "Today";
  const days = Math.abs(daysUntil);
  const plural = days === 1 ? "day" : "days";
  return daysUntil > 0 ? `${days} ${plural}` : `${days} ${plural} ago`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/src/components/event-risk-panel.test.tsx`
Expected: PASS, all three tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/use-event-progress.ts frontend/src/components/event-risk-panel.tsx frontend/src/components/event-risk-panel.test.tsx
git commit -m "feat(frontend): surface event risk from the progress endpoint"
```

---

### Task 4: Events list — server-side filters and Load more

`nextCursor` is parsed and discarded today (`use-events.ts:13`, and its own comment
admits "No pagination wiring yet"). This task spends it.

**Files:**

- Modify: `frontend/src/hooks/use-events.ts` (full rewrite of the hook body)
- Create: `frontend/src/components/event-filters.tsx`
- Modify: `frontend/src/routes/events.tsx`
- Test: `frontend/src/routes/events.test.tsx`

**Interfaces:**

- Consumes: `listEventsResponseSchema`, `eventStatusSchema`, `type EventSummary` from `@ctp/shared`.
- Produces:
  - `export type EventsQuery = { teamId?: string; status?: string; from?: string; to?: string; ownerId?: string }`
  - `useEvents(query?: EventsQuery)` now returns
    `{ state: EventsState; loadMore: () => Promise<void>; loadingMore: boolean; mutationError: string | undefined }`
    — **a shape change** (decision 9), matching `useMembers`/`useNotifications`.
  - `<EventFilters time status onTimeChange onStatusChange />` where
    `time: "upcoming" | "past" | "all"`.

  Task 5 adds `createEvent` to the same returned object.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/routes/events.test.tsx`. Keep every existing test — especially
the `0752ade` HTML-error-page test.

```tsx
it("asks the API for upcoming events by default", async () => {
  const fetchMock = stubFetch({ items: [], nextCursor: null });
  renderPage();

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toContain("/api/events?");
  expect(url).toContain("from=");
  expect(url).not.toContain("to=");
});

it("swaps from= for to= when the reader asks for past events", async () => {
  const user = userEvent.setup();
  const fetchMock = stubFetch({ items: [], nextCursor: null });
  renderPage();

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "Past" }));

  await waitFor(() => {
    const [url] = fetchMock.mock.calls.at(-1) as [string];
    expect(url).toContain("to=");
    expect(url).not.toContain("from=");
  });
});

it("passes the chosen status through, cancelled included", async () => {
  const user = userEvent.setup();
  const fetchMock = stubFetch({ items: [], nextCursor: null });
  renderPage();

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await user.selectOptions(screen.getByLabelText("Status"), "cancelled");

  await waitFor(() => {
    const [url] = fetchMock.mock.calls.at(-1) as [string];
    expect(url).toContain("status=cancelled");
  });
});

it("appends the next page and hides the button at the end of the list", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(ok({ items: [summary("AGM")], nextCursor: "abc" }))
    .mockResolvedValueOnce(ok({ items: [summary("Showcase")], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  renderPage();

  await waitFor(() => expect(screen.getByText("AGM")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Load More" }));

  await waitFor(() => expect(screen.getByText("Showcase")).toBeInTheDocument());
  expect(screen.getByText("AGM")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
  expect((fetchMock.mock.calls.at(-1) as [string])[0]).toContain("cursor=abc");
});
```

Add these helpers beside the existing `renderPage` / `stubFetch`, and change
`stubFetch` to return the mock so the assertions above can read its calls:

```tsx
function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function stubFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(ok(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function summary(title: string) {
  return {
    id: `018f3a4b-0000-7000-8000-${title.length.toString().padStart(12, "0")}`,
    title,
    status: "planning",
    startsAt: "2026-11-01T10:00:00.000Z",
    endsAt: null,
    venue: null,
    minTier: 0,
    owner: null,
    taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 0 },
    overdueCount: 0,
    budget: { allocationCents: 0, committedCents: 0, spentCents: 0 },
  };
}
```

Import `userEvent` at the top: `import userEvent from "@testing-library/user-event";`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/routes/events.test.tsx`
Expected: FAIL — no `Past` button, no `Status` label, no `Load More` button.

- [ ] **Step 3: Rewrite the hook**

Replace the body of `frontend/src/hooks/use-events.ts`:

```ts
import { listEventsResponseSchema, type EventSummary } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

export type EventsQuery = {
  teamId?: string;
  status?: string;
  from?: string;
  to?: string;
  ownerId?: string;
};

type EventsState =
  | { status: "loading" }
  | { status: "ok"; items: EventSummary[]; nextCursor: string | null }
  | { status: "error"; message: string };

/** `cursor` is opaque — base64 of `startsAt|id`. Pass `nextCursor` back verbatim. */
function toSearch(query: EventsQuery, cursor?: string) {
  const params = new URLSearchParams();
  if (query.teamId) params.set("teamId", query.teamId);
  if (query.status) params.set("status", query.status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.ownerId) params.set("ownerId", query.ownerId);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * ViewModel for the event list (R9). Fetches and parses against the shared
 * schema; `routes/events.tsx` stays declarative. Filtering is server-side —
 * the API sorts `startsAt DESC`, so a client-side split would show groups that
 * stay partial until the reader pages to the bottom.
 */
export function useEvents(query: EventsQuery = {}) {
  const { teamId, status, from, to, ownerId } = query;
  const [state, setState] = useState<EventsState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    fetch(`/api/events${toSearch({ teamId, status, from, to, ownerId })}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load events");
        return listEventsResponseSchema.parse(await res.json());
      })
      .then((parsed) => {
        if (active) setState({ status: "ok", items: parsed.items, nextCursor: parsed.nextCursor });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Unknown error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [teamId, status, from, to, ownerId]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ok" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMutationError(undefined);
    try {
      const search = toSearch({ teamId, status, from, to, ownerId }, state.nextCursor);
      const res = await fetch(`/api/events${search}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load more events");
      const parsed = listEventsResponseSchema.parse(await res.json());
      setState((previous) =>
        previous.status === "ok"
          ? {
              status: "ok",
              items: [...previous.items, ...parsed.items],
              nextCursor: parsed.nextCursor,
            }
          : previous,
      );
    } catch (cause: unknown) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to load more events");
    } finally {
      setLoadingMore(false);
    }
  }, [state, loadingMore, teamId, status, from, to, ownerId]);

  return { state, loadMore, loadingMore, mutationError };
}
```

- [ ] **Step 4: Write the filter control**

`frontend/src/components/event-filters.tsx`. The time control reuses the
segmented-control markup from `notifications.tsx:52-67` verbatim.

```tsx
import { eventStatusSchema } from "@ctp/shared";
import { cn } from "@/lib/utils";

export type TimeFilter = "upcoming" | "past" | "all";

const times: { value: TimeFilter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
];

function statusLabel(status: string) {
  return status.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function EventFilters({
  time,
  status,
  onTimeChange,
  onStatusChange,
}: {
  time: TimeFilter;
  status: string;
  onTimeChange: (next: TimeFilter) => void;
  onStatusChange: (next: string) => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-1 rounded-lg bg-secondary p-1" aria-label="Event time filter">
        {times.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={time === option.value}
            onClick={() => onTimeChange(option.value)}
            className={cn(
              "flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-none",
              time === option.value && "bg-card text-foreground shadow-sm",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="event-status">
          Status
        </label>
        <select
          id="event-status"
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          className="h-9 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Any status</option>
          {eventStatusSchema.options.map((option) => (
            <option key={option} value={option}>
              {statusLabel(option)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the page**

In `frontend/src/routes/events.tsx`: add the imports, the filter state, and change
every `events.status` reference to `events.state.status`.

```tsx
import { useMemo, useState } from "react";
import { EventFilters, type TimeFilter } from "@/components/event-filters";
import { Button } from "@/components/ui/button";
```

Inside `EventsPage`, replacing `const events = useEvents();`:

```tsx
const [time, setTime] = useState<TimeFilter>("upcoming");
const [status, setStatus] = useState("");
// One timestamp per mount — a fresh `new Date()` each render would refetch forever.
const now = useMemo(() => new Date().toISOString(), []);
const query = useMemo(
  () => ({
    status: status || undefined,
    from: time === "upcoming" ? now : undefined,
    to: time === "past" ? now : undefined,
  }),
  [status, time, now],
);
const events = useEvents(query);
const { state } = events;
```

Render `<EventFilters …>` directly under `<PageHeader …>`, then swap the four
`events.status === …` guards to `state.status === …` and `events.items` to
`state.items`. After the closing `</section>` of the list, add:

```tsx
{
  state.status === "ok" && state.nextCursor && (
    <div className="mt-6 flex justify-center">
      <Button
        variant="outline"
        disabled={events.loadingMore}
        onClick={() => void events.loadMore()}
      >
        {events.loadingMore ? "Loading…" : "Load More"}
      </Button>
    </div>
  );
}
{
  events.mutationError && (
    <p className="mt-4 text-sm text-destructive" role="alert">
      {events.mutationError}. Try again.
    </p>
  );
}
```

Also show the real window now that `endsAt` is available — replace the single
`<time>` in the card with:

```tsx
<time dateTime={new Date(event.startsAt).toISOString()}>
  {eventDate.format(new Date(event.startsAt))}
</time>;
{
  event.endsAt && <span>– {eventDate.format(new Date(event.endsAt))}</span>;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/routes/events.test.tsx`
Expected: PASS, all tests including the two pre-existing ones.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/use-events.ts frontend/src/components/event-filters.tsx frontend/src/routes/events.tsx frontend/src/routes/events.test.tsx
git commit -m "feat(frontend): filter and paginate the event list"
```

---

### Task 5: Create an event (tier 1+)

`POST /api/events` is tier 1. `createEventSchema` requires only `title` and
`startsAt`; venue is the one optional field worth the space (decision 8).

**Files:**

- Create: `frontend/src/components/create-event-form.tsx`
- Modify: `frontend/src/hooks/use-events.ts` (add `createEvent`)
- Modify: `frontend/src/routes/events.tsx`
- Test: `frontend/src/routes/events.test.tsx`

**Interfaces:**

- Consumes: `useEvents` from Task 4; `useMe` for the tier check; `Button`, `Card`,
  `Input`, `Label` from `@/components/ui/*`.
- Produces:
  - `useEvents()` gains `createEvent(input: { title: string; startsAt: string; venue?: string }): Promise<boolean>`
    and `busy: boolean` on its returned object.
  - `<CreateEventForm onSubmit busy />`

- [ ] **Step 1: Write the failing test**

```tsx
it("hides the create form from tier 0 and shows it to tier 1", async () => {
  const fetchMock = vi
    .fn()
    .mockImplementation((url: string) =>
      url === "/api/me"
        ? Promise.resolve(ok({ user: { id: "u1", email: "a@b.c", role: "member", tier: 0 } }))
        : Promise.resolve(ok({ items: [], nextCursor: null })),
    );
  vi.stubGlobal("fetch", fetchMock);
  renderPage();

  await waitFor(() => expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Create Event" })).not.toBeInTheDocument();
});

it("posts a new event and clears the form", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/me") {
      return Promise.resolve(ok({ user: { id: "u1", email: "a@b.c", role: "director", tier: 1 } }));
    }
    if (init?.method === "POST") return Promise.resolve(ok({ event: summary("AGM") }));
    return Promise.resolve(ok({ items: [], nextCursor: null }));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage();

  await user.type(await screen.findByLabelText("Title"), "AGM");
  await user.type(screen.getByLabelText("Starts At"), "2026-11-01T10:00");
  await user.click(screen.getByRole("button", { name: "Create Event" }));

  await waitFor(() => {
    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeDefined();
    expect(JSON.parse((post as [string, RequestInit])[1].body as string)).toMatchObject({
      title: "AGM",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/routes/events.test.tsx`
Expected: FAIL — no `Create Event` button, no `Title` field.

- [ ] **Step 3: Add `createEvent` to the hook**

In `frontend/src/hooks/use-events.ts`, add `const [busy, setBusy] = useState(false);`
beside the other state, then this callback before the `return`:

```ts
const createEvent = useCallback(
  async (input: { title: string; startsAt: string; venue?: string }) => {
    setBusy(true);
    setMutationError(undefined);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          startsAt: new Date(input.startsAt).toISOString(),
          ...(input.venue ? { venue: input.venue } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to create the event");
      const parsed = eventResponseSchema.parse(await res.json());
      setState((previous) =>
        previous.status === "ok"
          ? { ...previous, items: [parsed.event, ...previous.items] }
          : previous,
      );
      return true;
    } catch (cause: unknown) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to create the event");
      return false;
    } finally {
      setBusy(false);
    }
  },
  [],
);
```

Extend the import to `import { eventResponseSchema, listEventsResponseSchema, type EventSummary } from "@ctp/shared";`
and the return to `return { state, loadMore, loadingMore, createEvent, busy, mutationError };`

- [ ] **Step 4: Write the form**

`frontend/src/components/create-event-form.tsx`, mirroring the Add Task card at
`frontend/src/routes/tasks.tsx:40-70`:

```tsx
import { CalendarPlus } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateEventForm({
  onSubmit,
  busy,
}: {
  onSubmit: (input: { title: string; startsAt: string; venue?: string }) => Promise<boolean>;
  busy: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const startsAt = String(data.get("startsAt") ?? "");
    const venue = String(data.get("venue") ?? "").trim();
    if (!title || !startsAt) return;
    void onSubmit({ title, startsAt, venue: venue || undefined }).then((created) => {
      if (created) form.reset();
    });
  }

  return (
    <Card className="mt-8 shadow-none">
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CalendarPlus aria-hidden="true" className="size-5 text-muted-foreground" />
          New Event
        </h2>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-[1fr_14rem_1fr_auto]" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="event-title">Title</Label>
            <Input id="event-title" name="title" autoComplete="off" maxLength={200} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="event-starts-at">Starts At</Label>
            <Input id="event-starts-at" name="startsAt" type="datetime-local" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="event-venue">Venue</Label>
            <Input id="event-venue" name="venue" autoComplete="off" maxLength={200} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create Event"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Gate it on tier in the page**

In `frontend/src/routes/events.tsx`:

```tsx
import { CreateEventForm } from "@/components/create-event-form";
import { useMe } from "@/hooks/use-me";
```

```tsx
const me = useMe();
const canCreate = me.status === "ok" && me.user.tier >= 1;
```

Render between `<PageHeader …>` and `<EventFilters …>`:

```tsx
{
  canCreate && <CreateEventForm onSubmit={events.createEvent} busy={events.busy} />;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/routes/events.test.tsx`
Expected: PASS, every test.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/create-event-form.tsx frontend/src/hooks/use-events.ts frontend/src/routes/events.tsx frontend/src/routes/events.test.tsx
git commit -m "feat(frontend): create events from the list page"
```

---

### Task 6: Extract the task board, then put the detail page in tabs

**Files:**

- Create: `frontend/src/components/event-task-board.tsx`
- Modify: `frontend/src/routes/event-detail.tsx`
- Modify: `frontend/src/hooks/use-event.ts` (URL + return shape)
- Test: `frontend/src/routes/event-detail.test.tsx`

**Interfaces:**

- Consumes: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (Task 2);
  `useEventProgress` + `EventRiskPanel` (Task 3); `useSearchParams` from
  `react-router-dom`.
- Produces:
  - `<EventTaskBoard tasks={Task[]} />` — the four-column board lifted verbatim
    out of `event-detail.tsx`, including its private `TaskCard`.
  - `useEvent(id)` now returns `{ state, … }` (decision 9) and fetches
    `?include=tasks,channel` (decision 4).

  Task 7 fills the Thread/Files/RSVPs panels; Task 8 adds `cancelEvent`.

- [ ] **Step 1: Write the failing tests**

Update the existing test's URL assertion (decision 4) and add tab coverage:

```tsx
// CHANGED, not new — decision 4. The Thread tab needs channelId, which the API
// only sends when include=channel is asked for.
expect(fetchMock).toHaveBeenCalledWith(
  "/api/events/018f3a4b-0000-7000-8000-000000000001?include=tasks,channel",
  { credentials: "include" },
);
```

```tsx
it("opens on Overview and shows the risk verdict", async () => {
  stubEvent();
  renderDetail();

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
  );
  expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByText("At Risk")).toBeInTheDocument();
  expect(screen.getByText("1 overdue task")).toBeInTheDocument();
});

it("shows the task board only once the Tasks tab is chosen", async () => {
  const user = userEvent.setup();
  stubEvent();
  renderDetail();

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
  );
  expect(screen.queryByText("Confirm lighting")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Tasks" }));

  expect(await screen.findByText("Confirm lighting")).toBeInTheDocument();
});

it("takes the open tab from the URL", async () => {
  stubEvent();
  renderDetail("?tab=tasks");

  expect(await screen.findByText("Confirm lighting")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "true");
});
```

Refactor the existing inline fixture into helpers so all four tests share it —
`stubEvent()` returns the mock, and routes `/progress` separately:

```tsx
const EVENT_ID = "018f3a4b-0000-7000-8000-000000000001";

function stubEvent() {
  const fetchMock = vi.fn().mockImplementation((url: string) =>
    url.includes("/progress")
      ? Promise.resolve(
          ok({
            percentComplete: 0,
            overdueCount: 1,
            daysUntil: 15,
            budgetBurn: 0.24,
            risk: "at_risk",
            riskReasons: ["1 overdue task"],
          }),
        )
      : Promise.resolve(ok({ event: eventFixture })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDetail(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/events/${EVENT_ID}${search}`]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
```

Lift the existing event object out of the first test into a module-level
`const eventFixture = { … }` — same fields, unchanged, plus `channelId: "018f3a4b-0000-7000-8000-000000000003"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/routes/event-detail.test.tsx`
Expected: FAIL — no `tab` roles; the URL assertion still reads `?include=tasks`.

- [ ] **Step 3: Extract the board**

Create `frontend/src/components/event-task-board.tsx` by moving the `columns`
constant, the board `<div className="mt-3 grid gap-3 …">` block, the `shortDate`
formatter and the `TaskCard` function out of `event-detail.tsx` unchanged:

```tsx
import type { Task, TaskStatus } from "@ctp/shared";
import { PriorityDot } from "@/components/priority-dot";
import { Card, CardContent } from "@/components/ui/card";

const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const columns: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export function EventTaskBoard({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No tasks are linked to this event yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {columns.map((column) => {
        const items = tasks.filter((task) => task.status === column.status);
        return (
          <section key={column.status} aria-labelledby={`${column.status}-heading`}>
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <h3 id={`${column.status}-heading`} className="text-sm font-semibold">
                {column.label}
              </h3>
              <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
            </div>
            <div className="grid gap-2">
              {items.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                  No tasks
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <Card className="gap-3 py-4 shadow-none">
      <CardContent className="px-4">
        <div className="flex items-start gap-2">
          <span className="mt-1.5">
            <PriorityDot priority={task.priority} />
          </span>
          <h4 className="text-sm leading-5 font-medium">{task.title}</h4>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {task.dueAt ? `Due ${shortDate.format(task.dueAt)}` : "No due date"}
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Update the hook's URL and return shape**

In `frontend/src/hooks/use-event.ts`, change the fetch URL to
`` `/api/events/${id}?include=tasks,channel` `` and the final line from
`return state;` to `return { state };`. Task 8 adds `cancelEvent` alongside.

- [ ] **Step 5: Put the page in tabs**

In `frontend/src/routes/event-detail.tsx`: drop the `columns`/`shortDate`/`TaskCard`
definitions now living in the board, and add:

```tsx
import { useSearchParams } from "react-router-dom";
import { EventRiskPanel } from "@/components/event-risk-panel";
import { EventTaskBoard } from "@/components/event-task-board";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEventProgress } from "@/hooks/use-event-progress";
```

Inside the component, above the early returns:

```tsx
const { id } = useParams();
const { state } = useEvent(id);
const progress = useEventProgress(id);
const [searchParams, setSearchParams] = useSearchParams();
const tab = searchParams.get("tab") ?? "overview";

function selectTab(next: string) {
  const params = new URLSearchParams(searchParams);
  params.set("tab", next);
  setSearchParams(params);
}
```

Replace the `About` / `Event Budget` grid and the `Tasks` section with:

```tsx
<Tabs value={tab} onValueChange={selectTab} className="mt-8">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="tasks">Tasks</TabsTrigger>
    <TabsTrigger value="thread">Thread</TabsTrigger>
    <TabsTrigger value="files">Files</TabsTrigger>
    <TabsTrigger value="rsvps">RSVPs</TabsTrigger>
  </TabsList>

  <TabsContent value="overview">
    <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_0.6fr]">
      <Card className="shadow-none">
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight">About</h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            {event.description || "No event description has been added yet."}
          </p>
          {event.attendanceEstimate !== null && (
            <p className="mt-4 text-sm text-muted-foreground">
              Expected attendance:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {event.attendanceEstimate}
              </span>
            </p>
          )}
          <div className="mt-6 border-t pt-5">
            <h3 className="mb-3 text-sm font-medium">Delivery Progress</h3>
            <EventHealthStrip
              taskCounts={event.taskCounts}
              overdueCount={event.overdueCount}
              budget={event.budget}
            />
          </div>
          <div className="mt-6 border-t pt-5">
            {progress.status === "ok" ? (
              <EventRiskPanel progress={progress.progress} />
            ) : progress.status === "loading" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading Risk…
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                The risk verdict is unavailable right now.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Event Budget</h2>
            <CircleDollarSign aria-hidden="true" className="size-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <BudgetRow label="Allocated" cents={event.budget.allocationCents} />
          <BudgetRow label="Committed" cents={event.budget.committedCents} />
          <BudgetRow label="Paid" cents={event.budget.spentCents} />
        </CardContent>
      </Card>
    </div>
  </TabsContent>

  <TabsContent value="tasks">
    <EventTaskBoard tasks={tasks} />
  </TabsContent>

  <TabsContent value="thread">{/* Task 7 */}</TabsContent>
  <TabsContent value="files">{/* Task 7 */}</TabsContent>
  <TabsContent value="rsvps">{/* Task 7 */}</TabsContent>
</Tabs>
```

Note the failure message for `progress` is deliberately soft: a missing verdict
must not read like the event itself failed to load.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/routes/event-detail.test.tsx`
Expected: PASS, all tests including Task 1's error test.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/event-task-board.tsx frontend/src/hooks/use-event.ts frontend/src/routes/event-detail.tsx frontend/src/routes/event-detail.test.tsx
git commit -m "feat(frontend): put the event detail page in tabs"
```

---

### Task 7: Thread tab, and honest stubs for Files and RSVPs

**Files:**

- Modify: `frontend/src/routes/event-detail.tsx`
- Test: `frontend/src/routes/event-detail.test.tsx`

**Interfaces:**

- Consumes: `useThreadMessages` from `@/hooks/use-threads` (already built —
  `frontend/src/hooks/use-threads.ts:66`, returns `{ state, … }`); `useMembers` for
  author names; `UserAvatar`; `event.channelId` from Task 6's `include=channel`.
- Produces: a private `ThreadMessage` component inside `event-detail.tsx`.

Steps 3 and 4 land together: Step 3's panel markup calls `ThreadMessage` and
`memberItems`, which Step 4 defines. Both are in place before the test runs.

- [ ] **Step 1: Write the failing test**

```tsx
it("renders the event thread and marks the dead tabs as unbuilt", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/progress")) return Promise.resolve(ok(progressFixture));
    if (url.includes("/messages")) {
      return Promise.resolve(ok({ items: [], nextCursor: null }));
    }
    return Promise.resolve(ok({ event: eventFixture }));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderDetail();

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
  );

  await user.click(screen.getByRole("tab", { name: "RSVPs" }));
  expect(await screen.findByText(/rsvp tracking is not built yet/i)).toBeInTheDocument();
});
```

Hoist `progressFixture` out of `stubEvent` in Task 6 so both share it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/routes/event-detail.test.tsx`
Expected: FAIL — the RSVPs panel is empty.

- [ ] **Step 3: Fill the three panels**

Add `import { useThreadMessages } from "@/hooks/use-threads";` and, beside the other
hooks, `const messages = useThreadMessages(state.status === "ok" ? state.event.channelId : undefined);`

**Hook-order note:** `useEvent`/`useEventProgress`/`useSearchParams` already sit
above the early returns; `useThreadMessages` must too, or the hook order changes
between renders. It accepts `undefined` and stays idle, which is why this is safe.

Replace the three placeholder panels:

```tsx
<TabsContent value="thread">
  <Card className="shadow-none">
    <CardHeader>
      <h2 className="text-lg font-semibold tracking-tight">Event Thread</h2>
      <p className="text-sm text-muted-foreground">
        Discussion attached to this event. Full posting lives on Messages.
      </p>
    </CardHeader>
    <CardContent>
      {!event.channelId ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          This event has no thread yet.
        </p>
      ) : messages.state.status === "loading" ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading Thread…
        </p>
      ) : messages.state.status === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load the thread: {messages.state.message}. Refresh the page to try again.
        </p>
      ) : messages.state.status === "ok" && messages.state.items.length > 0 ? (
        <ol className="grid gap-4">
          {[...messages.state.items].reverse().map((message) => (
            <li key={message.id}>
              <ThreadMessage message={message} members={memberItems} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No messages in this thread yet.
        </p>
      )}
    </CardContent>
  </Card>
</TabsContent>;

{
  /* TODO(R11): file upload is Deferred — no storage endpoint exists yet. */
}
<TabsContent value="files">
  <Card className="border-dashed shadow-none">
    <CardContent className="py-12 text-center text-sm text-muted-foreground">
      File attachments are not built yet. Documents and images will attach here once upload ships.
    </CardContent>
  </Card>
</TabsContent>;

{
  /* TODO(R4): RSVP tracker — no schema, table or endpoint exists yet. */
}
<TabsContent value="rsvps">
  <Card className="border-dashed shadow-none">
    <CardContent className="py-12 text-center text-sm text-muted-foreground">
      RSVP tracking is not built yet. Attendance responses will appear here once the endpoint ships.
    </CardContent>
  </Card>
</TabsContent>;
```

- [ ] **Step 4: Add the message row**

`messageSchema` carries `author` as a **UUID, not a name** — there is no
`authorName` field. `messages.tsx:161-190` already solves this; copy that approach
rather than inventing a field. Add to `event-detail.tsx`:

```tsx
import type { Message, RosterMember } from "@ctp/shared";
import { UserAvatar } from "@/components/user-avatar";
import { useMembers } from "@/hooks/use-members";
```

Beside the other hooks, above the early returns:

```tsx
const members = useMembers();
const memberItems = members.state.status === "ok" ? members.state.items : [];
```

And at the foot of the file, matching `MessageRow` in `messages.tsx`:

```tsx
function ThreadMessage({ message, members }: { message: Message; members: RosterMember[] }) {
  const author = members.find((member) => member.id === message.author);
  const name = message.aiRunId ? "MAC Assistant" : author?.name || author?.email || "Former Member";

  return (
    <article className="flex items-start gap-3 rounded-lg border p-4">
      <UserAvatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold">{name}</h3>
          <time
            dateTime={message.createdAt.toISOString()}
            className="text-xs text-muted-foreground"
          >
            {dateTime.format(message.createdAt)}
          </time>
        </div>
        <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">{message.body}</p>
      </div>
    </article>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/src/routes/event-detail.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/event-detail.tsx frontend/src/routes/event-detail.test.tsx
git commit -m "feat(frontend): add the event thread tab"
```

---

### Task 8: Cancel an event (president only)

`DELETE /api/events/:id` is the only door into `cancelled`, and `event:cancel`
belongs to the president alone — tier 2 also holds the VP, treasurer and secretary,
so a tier check cannot express it (`shared/src/auth/capabilities.ts:11`).

**Files:**

- Modify: `frontend/src/hooks/use-event.ts` (add `cancelEvent`)
- Modify: `frontend/src/routes/event-detail.tsx`
- Test: `frontend/src/routes/event-detail.test.tsx`

**Interfaces:**

- Consumes: `can` from `@ctp/shared`; `useMe`; `Button`.
- Produces: `useEvent(id)` returns
  `{ state, cancelEvent: () => Promise<boolean>, busy: boolean, mutationError: string | undefined }`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("offers cancel to the president only", async () => {
  stubEvent({ role: "treasurer" });
  renderDetail();

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
  );
  expect(screen.queryByRole("button", { name: "Cancel Event" })).not.toBeInTheDocument();
});

it("confirms before sending the DELETE", async () => {
  const user = userEvent.setup();
  const fetchMock = stubEvent({ role: "president" });
  renderDetail();

  await user.click(await screen.findByRole("button", { name: "Cancel Event" }));
  expect(screen.getByText(/cancelling releases the unspent allocation/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Confirm Cancellation" }));

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(call).toBeDefined();
  });
});
```

Extend `stubEvent` to accept `{ role }` and answer `/api/me` with
`{ user: { id: "u1", email: "a@b.c", role, tier: role === "president" ? 2 : 2 } }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/routes/event-detail.test.tsx`
Expected: FAIL — no `Cancel Event` button.

- [ ] **Step 3: Add `cancelEvent` to the hook**

In `frontend/src/hooks/use-event.ts`, add `useCallback` to the React import, then:

```ts
const [busy, setBusy] = useState(false);
const [mutationError, setMutationError] = useState<string>();

const cancelEvent = useCallback(async () => {
  if (!id) return false;
  setBusy(true);
  setMutationError(undefined);
  try {
    const res = await fetch(`/api/events/${id}`, { method: "DELETE", credentials: "include" });
    // 204 No Content — there is no body to parse.
    if (!res.ok) throw new Error("Failed to cancel the event");
    setState((previous) =>
      previous.status === "ok"
        ? { ...previous, event: { ...previous.event, status: "cancelled" } }
        : previous,
    );
    return true;
  } catch (cause: unknown) {
    setMutationError(cause instanceof Error ? cause.message : "Failed to cancel the event");
    return false;
  } finally {
    setBusy(false);
  }
}, [id]);

return { state, cancelEvent, busy, mutationError };
```

- [ ] **Step 4: Wire the confirmation**

In `frontend/src/routes/event-detail.tsx`:

```tsx
import { can } from "@ctp/shared";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
```

Above the early returns:

```tsx
const me = useMe();
const [confirming, setConfirming] = useState(false);
const canCancel = me.status === "ok" && can(me.user.role, "event:cancel");
```

Pass the action into the existing `PageHeader`:

```tsx
<PageHeader
  title={event.title}
  actions={
    <>
      <StatusBadge status={event.status} />
      {canCancel && event.status !== "cancelled" && (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          Cancel Event
        </Button>
      )}
    </>
  }
/>;

{
  confirming && (
    <Card className="mt-6 shadow-none">
      <CardHeader>
        <h2 className="font-semibold">Cancel this event?</h2>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Cancelling releases the unspent allocation and notifies everyone holding an open task. The
        event stays readable, but it cannot be un-cancelled.
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" disabled={detail.busy} onClick={() => setConfirming(false)}>
          Keep Event
        </Button>
        <Button
          disabled={detail.busy}
          onClick={() => void detail.cancelEvent().then((done) => done && setConfirming(false))}
        >
          {detail.busy ? "Cancelling…" : "Confirm Cancellation"}
        </Button>
      </CardFooter>
    </Card>
  );
}
{
  detail.mutationError && (
    <p className="mt-4 text-sm text-destructive" role="alert">
      {detail.mutationError}. Try again.
    </p>
  );
}
```

Rename the hook call to `const detail = useEvent(id);` with `const { state } = detail;`,
and add `CardFooter` to the `@/components/ui/card` import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/routes/event-detail.test.tsx`
Expected: PASS, every test.

- [ ] **Step 6: Run the whole unit suite and the linters**

```bash
npm run test:unit
npm run typecheck
npm run lint
npm run format:check
```

Expected: all green. `format:check` failures are fixed with `npm run format`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/use-event.ts frontend/src/routes/event-detail.tsx frontend/src/routes/event-detail.test.tsx
git commit -m "feat(frontend): let the president cancel an event"
```

---

## Verification

Run the full gate before opening a PR. `test:integration` needs Docker Postgres up
and `test:e2e` needs Playwright browsers:

```bash
npm run verify
```

The axe scan in `e2e/a11y.spec.ts` covers the routes it already visits. The new
tabset is Radix, so `role="tablist"`, roving tabindex and arrow-key navigation come
from the primitive rather than from hand-written handlers — that is the reason
decision 2 chose it over copying the `aria-pressed` control.

## Out of scope

- The MAC palette swap (`TODO(theme)`) and the contrast recheck in `docs/accessibility.md`.
- RSVP and file-upload **backends** — this plan only marks their absence in the UI.
- Editing an event (`PATCH /api/events/:id`) and the `warnings` array it returns
  when a date move strands task due dates.
- `PATCH /api/events/:id/status` (planning → live → wrapped).
- `?include=expenses`, which has no shared `expenseSchema` yet.
