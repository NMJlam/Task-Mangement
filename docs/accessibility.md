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
| `foreground` on `background`              | 20.17:1 | ✅ PASS    |
| `card-foreground` on `card`               | 20.17:1 | ✅ PASS    |
| `primary-foreground` on `primary`         | 17.05:1 | ✅ PASS    |
| `secondary-foreground` on `secondary`     | 16.28:1 | ✅ PASS    |
| `accent-foreground` on `accent`           | 16.28:1 | ✅ PASS    |
| `muted-foreground` on `background`        | 6.20:1  | ✅ PASS    |
| `destructive-foreground` on `destructive` | 4.55:1  | ✅ PASS    |

### Adjustment made

`muted-foreground` was darkened from shadcn's stock `oklch(0.554 …)` (**4.77:1**,
a thin margin) to `oklch(0.492 …)` (**6.20:1**) for headroom. `destructive`
passes at **4.55:1** — a narrow margin; **re-check it after the MAC palette
swap**, as it is the most likely pair to regress.

### ⚠️ Re-run this after the theme swap

These numbers are for the **slate placeholder** palette. When MAC's colours land
(`TODO(theme)` in `index.css`), recompute — `primary-foreground` on `primary`
and `muted-foreground` on `background` are the pairs most likely to fail. The
computation script lives in the scaffold PR notes; the method is oklch → linear
sRGB → relative luminance → `(L1+0.05)/(L2+0.05)`.
