# Accessibility (R14)

Evidence for the WCAG 2.1 AA audit in Increment 4. Two harnesses back this up:

- **Automated scan**: `e2e/a11y.spec.ts` runs `@axe-core/playwright` against the
  health page with tags `wcag2a wcag2aa wcag21a wcag21aa`. Currently **0
  violations**. Add a scan per new page as the UI grows.
- **Radix primitives**: every interactive control comes from shadcn/Radix, which
  supplies keyboard navigation and ARIA labelling (US-21, SC 2.1.1, 1.3.1). Do
  not hand-roll interactive elements; if you must, document the keyboard handling
  in the PR. `eslint-plugin-jsx-a11y` (recommended) enforces this in CI.

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
| `destructive-foreground` on `destructive` | 4.87:1  | ✅ PASS    |

### Adjustment made

The FE prototype's `muted` text was darkened from `#78766f` (**4.35:1**) to
`#706e68` (**4.88:1**) so normal copy clears AA. `destructive` passes at
**4.87:1**; both pairs should be re-checked after any palette change.

### ⚠️ Re-run this after the theme swap

These numbers are for the FE prototype palette. Recompute them whenever the
palette changes; `muted-foreground` and `destructive-foreground` have the least
headroom. The method is sRGB → relative luminance → `(L1+0.05)/(L2+0.05)`.
