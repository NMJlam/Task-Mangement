# Accessibility (R14)

Evidence for the WCAG 2.1 AA audit in Increment 4. Two harnesses back this up:

- **Automated scan**: `e2e/a11y.spec.ts` runs `@axe-core/playwright` against the
  health page with tags `wcag2a wcag2aa wcag21a wcag21aa`. Currently **0
  violations**. Add a scan per new page as the UI grows.
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

### ⚠️ Re-run this after the theme swap

These numbers are for the FE prototype palette. Recompute them whenever the
palette changes; `muted-foreground` and `destructive-foreground` have the least
headroom. The method is sRGB → relative luminance → `(L1+0.05)/(L2+0.05)`.
