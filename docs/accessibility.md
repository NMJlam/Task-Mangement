# Accessibility (R14)

Evidence for the WCAG 2.1 AA audit in Increment 4. Two harnesses back this up:

- **Automated scan**: `e2e/a11y.spec.ts` runs `@axe-core/playwright` against the
  health page with tags `wcag2a wcag2aa wcag21a wcag21aa`, plus the signed-in
  routes `/`, `/events`, one seeded `/events/:id`, `/tasks` and `/calendar`.
  Currently **0 violations**. Add a scan per new page as the UI grows.
  - The signed-in scans need a session, so they take the developer's own route
    in: `DEV_PASSWORD_AUTH=1`, an account created at `/scratch`, and
    `npm run db:dev-member -- <email> <role>` for the membership. Point the suite
    at it with `E2E_MEMBER_EMAIL` / `E2E_MEMBER_PASSWORD`. Without both the
    scans **skip** with that reason rather than failing — a machine with no dev
    member cannot answer the question, and a scan that silently covered only the
    login page would be worse than one that says it did not run. A role of lead
    or above is worth using: it renders the tier-gated controls (status
    transitions, New Event) that a tier-0 member never sees.
  - `axe` checks the rendered DOM, so a route still on its skeleton passes
    trivially. Each scan waits for `main` before analysing.
- **Radix primitives**: every interactive control comes from shadcn/Radix, which
  supplies keyboard navigation and ARIA labelling (US-21, SC 2.1.1, 1.3.1). Do
  not hand-roll interactive elements; if you must, document the keyboard handling
  in the PR. `eslint-plugin-jsx-a11y` (recommended) enforces this in CI.
- **Pointer drag-and-drop** is `@dnd-kit/react`, which ships a keyboard sensor —
  so the two drag surfaces (the task board, the calendar) are keyboard-operable
  rather than pointer-only. Space picks up, the arrow keys nudge the dragged item
  towards a target (Shift takes 5× steps), Space drops, Escape cancels. Both
  surfaces also replace the library's id-only announcements with sentences naming
  the row and the target; the calendar's are verified by driving it in a browser.
  Anything reachable _only_ by dragging has a non-drag path too: a task's status
  is a drag on the board but a picker in its dialog, and an event's dates are a
  drag on the grid, a form in its preview, and the same form on the event page.
  **Prefer the form** (Edit dates) when rescheduling by keyboard: the calendar's
  keyboard drag is reliable while the grid is on screen but loses its drop target
  deep into the month view, where a day cell can be taller than the viewport
  (dnd-kit moves the dragged shape in viewport space). The pointer drag has no
  such limit — it worked at every scroll position tried — and neither path can
  write anything wrong: a drop that resolves to no day is announced and ignored.

## Contrast table

WCAG 2.1 AA requires **≥ 4.5:1** for normal body text. Ratios computed from the
oklch tokens in `frontend/src/index.css` (converted oklch → linear sRGB → WCAG
relative luminance). Light theme:

| Token pair                                | Ratio   | AA (4.5:1) |
| ----------------------------------------- | ------- | ---------- |
| `foreground` on `background`              | 16.34:1 | ✅ PASS    |
| `card-foreground` on `card`               | 17.07:1 | ✅ PASS    |
| `primary-foreground` on `primary`         | 16.34:1 | ✅ PASS    |
| `secondary-foreground` on `secondary`     | 9.64:1  | ✅ PASS    |
| `accent-foreground` on `accent`           | 6.44:1  | ✅ PASS    |
| `muted-foreground` on `background`        | 4.88:1  | ✅ PASS    |
| `foreground` on `bg-muted/40` tint        | 15.78:1 | ✅ PASS    |
| `secondary-foreground` on `secondary`     | 9.64:1  | ✅ PASS    |
| `destructive-foreground` on `destructive` | 4.87:1  | ✅ PASS    |

### Adjustment made

The FE prototype's `muted` text was darkened from `#78766f` (**4.35:1**) to
`#706e68` (**4.88:1**) so normal copy clears AA. `destructive` passes at
**4.87:1**; both pairs should be re-checked after any palette change.

`muted-foreground` has so little headroom that it must never be faded further.
The calendar's adjacent-month day cells are tinted with `bg-muted/40` (over
`background` that is **#f6f6f5**) instead of dimmed: the day number stays at
**15.78:1**. Fading the text to 60% opacity, as the shadcn `react-day-picker`
wrapper does by default, measures **2.38:1** and would fail AA — its outside
days and this grid's cells both carry full-strength colour as a result. Event
chips on `secondary` use `secondary-foreground` (**9.64:1**) rather than
`muted-foreground` (**4.51:1**), which is the thinnest pair in the palette.

### Status tints (Tailwind palette, not app tokens)

`StatusBadge` and (since the calendar's chips took the same mapping) the event
chips render text on Tailwind palette tints. Those pairs are not among the oklch
tokens above, so they are measured separately — same method:

| Status                                         | Pair (light → dark)                        | Light     | Dark       |
| ---------------------------------------------- | ------------------------------------------ | --------- | ---------- |
| `planning`, `approved`, `in_progress`          | `accent-foreground` on `accent`            | 6.44:1 ✅ | token pair |
| `wrapped`, `todo`                              | `secondary-foreground` on `secondary`      | 9.64:1 ✅ | token pair |
| `live`, `paid`, `done`, `on_track`             | `emerald-700/50` → `emerald-300` on `-950` | 5.27:1 ✅ | 9.94:1 ✅  |
| `pending`, `at_risk`                           | `amber-800/50` → `amber-200` on `-950`     | 6.84:1 ✅ | 12.03:1 ✅ |
| `cancelled`, `rejected`, `blocked`, `critical` | `red-700/50` → `red-300` on `-950`         | 5.92:1 ✅ | 8.51:1 ✅  |

Both modes now clear AA on all five rows.

**This was a real failure, fixed rather than recorded.** The three tinted rows
shipped with `dark:bg-*-950` and no `dark:text-*`, leaving the light `-700`/`-800`
text on a near-black tint at **2.71:1**, **2.11:1** and **2.50:1** — all under
AA's 4.5:1, across `StatusBadge` and the calendar chips that share its mapping.
Adding the dark foregrounds also lifts every pair past AAA (7:1).

Two things kept it hidden, both now closed:

1. **The axe scans ran light-mode only**, where a `dark:` class is inert. `e2e/a11y.spec.ts` now scans each page twice, setting `localStorage.theme = "dark"`
   before the second pass.
2. **Nothing asserted the pairing.** `statusStyles` is now built from a named
   `tints` map, and `prototype-primitives.test.tsx` asserts that all ten tinted
   entries carry a `dark:text-*` — a unit-level guard, because a `dark:` class
   that is never rendered is invisible to axe either way.

Recompute these after the MAC palette swap; the method is unchanged.

Chips are otherwise colour-neutral where it matters: the chip body takes the
status tint and both its lines **inherit** that colour, so no unchecked pair is
introduced, and hover is a ring rather than a background swap for the same
reason. The chip's status is also in its accessible name, so the tint is
decoration rather than the only carrier of the value.

### ⚠️ Re-run this after the theme swap

These numbers are for the FE prototype palette. Recompute them whenever the
palette changes; `muted-foreground` and `destructive-foreground` have the least
headroom. The method is sRGB → relative luminance → `(L1+0.05)/(L2+0.05)`.
