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
    login page would be worse than one that says it did not run. Use `officer` or
    `lead`: a **tier-2 office that is not `officer`** renders the self-demotion
    overlay on every navigation, and an open modal is what the event-page scan
    waits past — `president` fails it for a fixture reason, not a contrast one.
  - `axe` checks the rendered DOM, so a route still on its skeleton passes
    trivially. Each scan waits for `main`, and then for every loading line to
    clear, before analysing. `main` renders before its data does, and waiting
    for it alone once let the calendar be scanned with no event chips on it.
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
  The board's sentences name the column **and the position** in it, and the
  keyboard sensor is the non-pointer path for both parts of a task move: a card's
  column is its status and its slot is its position in that column, and a drag
  (pointer or keyboard) is what changes either. There is no status picker in the
  card's dialog, so a drag is the only way to move a card — the keyboard sensor,
  not a form, is the fallback. An event's dates are a drag on the grid, a form in
  its preview, and the same form on the event page.
  **Prefer the form** (Edit dates) when rescheduling by keyboard: the calendar's
  keyboard drag is reliable while the grid is on screen but loses its drop target
  deep into the month view, where a day cell can be taller than the viewport
  (dnd-kit moves the dragged shape in viewport space). The pointer drag has no
  such limit — it worked at every scroll position tried — and neither path can
  write anything wrong: a drop that resolves to no day is announced and ignored.

## Contrast table

WCAG 2.1 AA requires **≥ 4.5:1** for normal body text. Ratios computed from the
hex tokens in `frontend/src/index.css` (sRGB → relative luminance →
`(L1+0.05)/(L2+0.05)`).

The palette is one system in two directions. Every token is defined in both
`:root` and `.dark`, so a pair cannot be "half-migrated" the way the old
`bg-emerald-50` / `dark:bg-emerald-950` tints could — that failure is recorded
below and is now unrepresentable.

Light theme — page `#fcfbf9`, panel `#f5f3ef`, ink `#14140f`, muted `#5d5b53`,
accent `#cc3700`:

| Token pair                                | Ratio   | AA (4.5:1) |
| ----------------------------------------- | ------- | ---------- |
| `foreground` on `background`              | 17.86:1 | ✅ PASS    |
| `card-foreground` on `card`               | 16.67:1 | ✅ PASS    |
| `primary-foreground` on `primary`         | 17.86:1 | ✅ PASS    |
| `secondary-foreground` on `secondary`     | 16.67:1 | ✅ PASS    |
| `accent-foreground` on `accent`           | 15.65:1 | ✅ PASS    |
| `muted-foreground` on `background`        | 6.58:1  | ✅ PASS    |
| `muted-foreground` on `card`              | 6.14:1  | ✅ PASS    |
| `ring` on `background`                    | 4.94:1  | ✅ PASS    |
| `ring` on `card`                          | 4.61:1  | ✅ PASS    |
| `background` on `ring` (`::selection`)    | 4.94:1  | ✅ PASS    |
| `destructive-foreground` on `destructive` | 6.32:1  | ✅ PASS    |
| `today-foreground` on `today`             | 5.66:1  | ✅ PASS    |

Dark theme — page `#12120f`, panel `#1b1b17`, ink `#f2f1ec`, muted `#a3a099`,
accent `#ff6b3d`:

| Token pair                                | Ratio   | AA (4.5:1) |
| ----------------------------------------- | ------- | ---------- |
| `foreground` on `background`              | 16.59:1 | ✅ PASS    |
| `card-foreground` on `card`               | 15.27:1 | ✅ PASS    |
| `primary-foreground` on `primary`         | 16.59:1 | ✅ PASS    |
| `secondary-foreground` on `secondary`     | 15.27:1 | ✅ PASS    |
| `accent-foreground` on `accent`           | 14.14:1 | ✅ PASS    |
| `muted-foreground` on `background`        | 7.19:1  | ✅ PASS    |
| `muted-foreground` on `card`              | 6.62:1  | ✅ PASS    |
| `ring` on `background`                    | 6.63:1  | ✅ PASS    |
| `ring` on `card`                          | 6.11:1  | ✅ PASS    |
| `background` on `ring` (`::selection`)    | 6.63:1  | ✅ PASS    |
| `destructive-foreground` on `destructive` | 9.16:1  | ✅ PASS    |

**`ring` is the thinnest meaningful pair in light mode (4.61:1 on a panel).** It
is the accent: the focus outline, the active-nav marker bar and the tab
underline, plus the `accent` status tone. Do not put it on `--accent` — the
hover wash measures **4.32:1** there and would fail.

The calendar's current day is `today`, a red of its own rather than
`destructive`. Its date badge is `today-foreground` on `today`: white on
`#c8231b` at **5.66:1** in light mode, `#16161a` on `#f97066` at **6.48:1** in
dark. Only the badge is red; the cell is not tinted, because a tint would thin
`muted-foreground` inside it. Today also carries `aria-current="date"`, so the
red is not the only signal.

### Terminal palettes (Settings)

Settings offers three more palettes beside light and dark. Each is a dark theme with a
full token set, measured with the same method; every pair passes. `--screen*` is shared
with the other themes, so the login screen's floors above still hold.

Amber phosphor — page `#120d05`, panel `#1a1408`, ink `#ffb54d`, accent `#fff0d1`:

| Pair                                      | Ratio      | Needs |
| ----------------------------------------- | ---------- | ----- |
| `foreground` on `background`              | 11.03:1 ✅ | 4.5:1 |
| `foreground` on `card`                    | 10.43:1 ✅ | 4.5:1 |
| `muted-foreground` on `background`        | 7.78:1 ✅  | 4.5:1 |
| `muted-foreground` on `card`              | 7.36:1 ✅  | 4.5:1 |
| `primary-foreground` on `primary`         | 11.03:1 ✅ | 4.5:1 |
| `ring` on `card`                          | 16.24:1 ✅ | 4.5:1 |
| `background` on `ring`                    | 17.17:1 ✅ | 4.5:1 |
| `destructive-foreground` on `destructive` | 8.38:1 ✅  | 4.5:1 |
| `today-foreground` on `today`             | 8.38:1 ✅  | 4.5:1 |
| `ok` on `card`                            | 11.48:1 ✅ | 4.5:1 |
| `warn` on `card`                          | 12.86:1 ✅ | 4.5:1 |
| `danger` on `card`                        | 7.93:1 ✅  | 4.5:1 |
| `input` on `background`                   | 4.54:1 ✅  | 3:1   |
| `input` on `card`                         | 4.30:1 ✅  | 3:1   |

Green phosphor — page `#03110a`, panel `#071a10`, ink `#5dfc8d`, accent `#dcffe6`:

| Pair                                      | Ratio      | Needs |
| ----------------------------------------- | ---------- | ----- |
| `foreground` on `background`              | 14.49:1 ✅ | 4.5:1 |
| `foreground` on `card`                    | 13.55:1 ✅ | 4.5:1 |
| `muted-foreground` on `background`        | 8.98:1 ✅  | 4.5:1 |
| `muted-foreground` on `card`              | 8.39:1 ✅  | 4.5:1 |
| `primary-foreground` on `primary`         | 14.49:1 ✅ | 4.5:1 |
| `ring` on `card`                          | 16.74:1 ✅ | 4.5:1 |
| `background` on `ring`                    | 17.91:1 ✅ | 4.5:1 |
| `destructive-foreground` on `destructive` | 8.75:1 ✅  | 4.5:1 |
| `today-foreground` on `today`             | 8.75:1 ✅  | 4.5:1 |
| `ok` on `card`                            | 13.55:1 ✅ | 4.5:1 |
| `warn` on `card`                          | 12.67:1 ✅ | 4.5:1 |
| `danger` on `card`                        | 8.18:1 ✅  | 4.5:1 |
| `input` on `background`                   | 4.48:1 ✅  | 3:1   |
| `input` on `card`                         | 4.19:1 ✅  | 3:1   |

Gruvbox — page `#282828`, panel `#32302f`, ink `#ebdbb2`, accent `#fe8019`:

| Pair                                      | Ratio      | Needs |
| ----------------------------------------- | ---------- | ----- |
| `foreground` on `background`              | 10.75:1 ✅ | 4.5:1 |
| `foreground` on `card`                    | 9.57:1 ✅  | 4.5:1 |
| `muted-foreground` on `background`        | 6.77:1 ✅  | 4.5:1 |
| `muted-foreground` on `card`              | 6.03:1 ✅  | 4.5:1 |
| `primary-foreground` on `primary`         | 10.75:1 ✅ | 4.5:1 |
| `ring` on `card`                          | 5.20:1 ✅  | 4.5:1 |
| `background` on `ring`                    | 5.84:1 ✅  | 4.5:1 |
| `destructive-foreground` on `destructive` | 5.16:1 ✅  | 4.5:1 |
| `today-foreground` on `today`             | 5.16:1 ✅  | 4.5:1 |
| `ok` on `card`                            | 6.36:1 ✅  | 4.5:1 |
| `warn` on `card`                          | 7.74:1 ✅  | 4.5:1 |
| `danger` on `card`                        | 4.60:1 ✅  | 4.5:1 |
| `input` on `background`                   | 4.02:1 ✅  | 3:1   |
| `input` on `card`                         | 3.58:1 ✅  | 3:1   |

The axe scans were run once per palette as a local, uncommitted pass, so the suite
stays two themes long. That pass covered the login page, `/`, `/events`, `/tasks`,
`/members`, `/settings` and `/calendar`, with each page waited on until its loading
lines had cleared. There were **0 colour violations**.

That pass also turned up a `nested-interactive` violation on the calendar, in
every theme. It came from the event chips, not the palettes, and it is now fixed.
dnd-kit marks up a draggable's handle, or its element when it has no handle, and
it does so even when the draggable is disabled. A chip the member cannot move has
no grip, so the chip itself became a disabled `role="button"` with
`tabindex="0"`, wrapped around its "Open …" button, which also left a dead tab
stop. Now only a movable chip hands its element to dnd-kit. The committed scans
missed it because they ran before the month's events arrived; they now wait.

### Non-text contrast (1.4.11)

| Boundary                      | Light     | Dark      |
| ----------------------------- | --------- | --------- |
| `--input` vs the page         | 3.25:1 ✅ | 3.50:1 ✅ |
| `--input` vs a panel (`card`) | 3.03:1 ✅ | 3.22:1 ✅ |

`--input` is deliberately darker than `--border` for this reason: a hairline
(`--border`, 1.27:1 light) groups panels, which 1.4.11 does not cover, whereas a
field boundary has to be perceivable on its own. Outlined buttons keep the
hairline and are identified by their label; the boundary goes to full ink on
hover and to `ring` on focus.

## Status colour

`common/status-badge.tsx` owns the vocabulary; the calendar's chips colour
themselves from the same map, so a chip and the badge behind it cannot disagree
about the same row. A status is coloured **text on a panel**, never a filled
pill, and the colour comes from `--ok` / `--warn` / `--danger` / `--ring`, which
both themes define:

| Tone               | Statuses                               | Light on card | Dark on card |
| ------------------ | -------------------------------------- | ------------- | ------------ |
| `ok` (green)       | live, paid, done, on_track             | 5.96:1 ✅     | 9.27:1 ✅    |
| `warn` (amber)     | pending, at_risk                       | 5.71:1 ✅     | 10.39:1 ✅   |
| `danger` (red)     | cancelled, rejected, blocked, critical | 5.90:1 ✅     | 8.43:1 ✅    |
| `ring` (accent)    | planning, approved, in_progress        | 4.61:1 ✅     | 6.11:1 ✅    |
| `muted-foreground` | wrapped, todo                          | 6.14:1 ✅     | 6.62:1 ✅    |

The calendar needs a chip that holds two lines of its own text, so it takes the
same tone as a **wash** and sets the text in ink rather than in the tone colour:

| Chip wash (15% tone over `card`) | Light wash | Ink on it  | Dark wash | Ink on it  |
| -------------------------------- | ---------- | ---------- | --------- | ---------- |
| `ok`                             | `#d2dfd4`  | 13.41:1 ✅ | `#25372b` | 11.19:1 ✅ |
| `warn`                           | `#e5dbcb`  | 13.48:1 ✅ | `#3c3423` | 10.87:1 ✅ |
| `danger`                         | `#ebd4d0`  | 13.07:1 ✅ | `#3d2e29` | 11.45:1 ✅ |
| `ring` (accent)                  | `#efd7cb`  | 13.42:1 ✅ | `#3d271d` | 12.33:1 ✅ |

Ink-on-wash is the rule for every tone, and that is a measurement, not a style
preference: the tone colour on its own wash holds for green (4.80:1), amber
(4.62:1) and red (4.63:1) but **fails for the accent at 3.71:1**. One rule that
holds for all five tones beats a rule with an exception nobody would remember.
The chip's status is in its accessible name, so the wash is decoration rather
than the only carrier of the value.

### The failure this replaced

The three tinted rows used to render Tailwind palette tints — `bg-emerald-50`
with `dark:bg-emerald-950` and no `dark:text-*` — leaving light `-700`/`-800`
text on a near-black tint at **2.71:1**, **2.11:1** and **2.50:1** across
`StatusBadge` and the calendar chips that shared its mapping. Two things hid it,
both now closed: the axe scans ran light-mode only (they now scan each page
twice, setting `localStorage.theme = "dark"` before the second pass), and
nothing asserted the pairing. `prototype-primitives.test.tsx` now asserts that
**no status resolves to a Tailwind palette colour and none carries a `dark:`
half** — a unit-level guard, because a `dark:` class is invisible to axe either
way.

## The terminal screen panel (login)

The login page's brand half is a terminal screen, not a page section: it keeps
the **same dark colour in both themes** (`--screen` `#14140f`). The previous
split screen used `bg-primary`, which inverts — in dark mode the "dark" panel
came out near-white, and a `/NN` faded text that read comfortably in light was
_weaker_ in dark, not stronger. The usual intuition that dark mode is the
forgiving one is exactly backwards for an inverting panel.

Measuring against a fixed colour instead of an inverting one is what makes these
floors hold twice over. `screen-foreground` (`#f2f1ec`) on `--screen` is
**16.34:1**, and the faded scale is:

| Opacity | Ratio   | Used by                    |
| ------- | ------- | -------------------------- |
| `/50`   | 4.80:1  | floor, nothing sits here   |
| `/60`   | 6.46:1  | club name (footer)         |
| `/65`   | 7.38:1  | "Club Operations", eyebrow |
| `/70`   | 8.39:1  | body copy                  |
| `/80`   | 10.69:1 | feature list               |

The accent cannot be used for text on the screen: `--ring` in light mode
(`#cc3700`) measures **3.62:1** on `#14140f`. `--screen-accent` (`#ff6b3d`, the
dark direction's orange) is fixed at **6.53:1** for the check glyphs there.

## Faded text elsewhere

- `muted-foreground` has the least headroom of the neutral pairs (4.61:1 for
  `ring`, 6.14:1 for itself on a panel). It must never be faded further.
- The calendar's adjacent-month day cells are tinted with `bg-foreground/5`
  instead of dimmed, so the day number keeps its full-strength colour. Fading the
  text to 60% opacity, as the shadcn `react-day-picker` wrapper does by default,
  measures **2.38:1** and would fail AA — its outside days and this grid's cells
  both carry full-strength colour as a result.
- `text-muted-foreground/40` on the calendar's **disabled** day buttons is left
  alone: disabled controls are exempt from 1.4.3, and axe skips them.

## Text-mode chrome

Three pieces draw the terminal with characters and lines rather than shapes.
None adds a colour pair: each uses tokens already measured above.

- **Text meters** (`TextMeter`, `[██████░░░░]`), used on the Overview's
  Committee Load, every event health strip and Finance's allocation table. A
  meter is a `role="progressbar"` with a name and an `aria-valuetext` that says
  the reading in words ("62% complete", "120% used, over budget"). The value is
  clamped to the maximum, so "over" is carried by the words and the `danger`
  colour, never by an out-of-range number. The drawing is `aria-hidden`: two
  runs, each as many characters wide as its cells. Two things were tried and
  dropped. `█`/`░` glyphs failed because Windows draws `░` from a taller
  fallback font, which overlapped the row below. A box per cell failed because
  at 125% and 150% scaling the boxes land on fractional pixels and show seams.
  The filled run is solid `foreground` (or `danger`, 5.90:1 light / 8.43:1
  dark), well over 1.4.11's 3:1 against the page or a panel. The track is a 35%
  tint of `muted-foreground` and the brackets are that colour at full strength
  (6.14:1 light / 6.62:1 dark on a panel). The track is a backdrop, not
  information: the filled run and the words carry the reading. **Forced
  colours** (Windows contrast themes) would blank every background, so the
  runs and the panels' top rules opt out with `forced-color-adjust: none` and
  draw in `CanvasText`, with the track as an outline.
- **Panels** (`Panel`, a box titled in its top border). Each is a `section`
  named by its own `h2`/`h3`, so it is a region a screen reader can jump to by
  name. The drawn lines are `--border` hairlines and `aria-hidden`. They group
  content, which 1.4.11 does not cover, the same as the cards they replace. The
  title straddles the page and the panel surface, and ink passes on both.
- **The status line** (a `footer` named "Status line", a contentinfo landmark).
  Its sync state **holds still** while the feed keeps up. It reads "synced",
  never a count of seconds: text that rewrites itself every second with no way
  to pause it is moving content under **2.2.2**. Only when reads fall behind
  (three poll intervals, at least 5s) does it change, once, to "last sync
  17:03". It is also **not a live region**. The unread count it shows is a
  link to the Inbox, and the sidebar's Inbox link already carries the count in
  its name. Focus never hides under it, because `html` has a bottom
  `scroll-padding` the height of the line plus the focus outline's offset. The text is `foreground`/`muted-foreground` on `card`, and
  "offline · retrying" is `danger` on `card`. The `$` prompt and the `●` unread
  marker are `ring` and decorative.

- **Loading lines** (`LoadingLine`). A `role="status"` whose label, "Loading
  Members…", is what a screen reader announces. The `| / - \` spinner beside it
  is `aria-hidden`, and pure ASCII: braille and block spinners come from a taller
  fallback font on Windows, as `░` once did. It stands still under
  `prefers-reduced-motion`.
- **Log tags** (`LogLine`, toasts). `[err]` and `[ok]` before a message are
  `aria-hidden`, and the message keeps its own words: an error is still an
  alert, and a success still a status. Toasts carry the same tags in place of
  icons.
- **Shell empty states** (`ShellEmpty`). The `$ ls tasks/` prompt line is
  `aria-hidden` decoration in `muted-foreground`, and the empty message beneath
  it reads exactly as before.
- **The ASCII wordmark** (`AsciiWordmark`, the sidebar and the login screen). A
  `role="img"` named "MAC", so its slashes and bars are never read out. It is
  pure ASCII, so the art lines up in any monospace font.
- **The ruled stat grid** (the Overview's "At a glance"). A definition list,
  each tiny uppercase label (`muted-foreground`, 11px) paired with its figure.
  The 1px rules are `--border` hairlines that group content.
- **The login dither.** A decorative dot pattern of the screen's ink at 14%,
  masked so it fades out before reaching any text. Forced colours drop it with
  the other background images.

## Keyboard shortcuts

The app has a keyboard layer, listed in full behind `?` or the status line's
`keys` button (a shadcn Dialog). These are the default keys:

- `g` then a letter jumps to a page.
- `n` is the page's new action, and `/` its search.
- `w` / `a` / `s` / `d` move up, left, down and right. That is the arrow cluster's
  shape on letters. Real arrow keys already scroll the page, and they drive the
  widgets that own them (tabs, selects, a picked-up drag handle), so the
  shortcuts leave them alone.

The moves work like a game pad's D-pad, on every page and in every popup. Each key
goes to the nearest control in that direction on screen, so down is always down,
whatever order the markup is in:

- in a two-column grid like the Settings themes;
- across the task board's columns and the Overview's panels;
- from one calendar day to the next;
- from an Inbox row's link to its Mark Read;
- in the Edit teams popover, between teams and between a team's membership and
  Lead boxes.

- **Which control counts as "that way".** Something overlapping your column counts
  as straight below (or above), and centre distance breaks ties off to the side.
  Left and right stay on the row, so with nothing level they go nowhere rather
  than jumping to a far corner.
- **The first move** lands on the first row of the page's main list (marked
  `data-key-list`), or on the first control if the page marks none.
- **In a popup.** With a dialog or popover open, the moves stay inside it, and
  every other shortcut is blocked so no key acts on the page behind it.
- **Past the end.** Up or down with nothing further that way scrolls the page,
  the way a pager does. So does a page with nothing to land on, like a member's
  read-only directory.
- **Fields.** A text field is never landed on, because a letter there must type.
- **Selects.** A `<select>` is landed on and stepped past, and the key is cancelled.
  Its type-ahead would otherwise turn `s` into a choice.
- **Type-ahead widgets** (listbox, menu, combobox, tree) keep their letters.

Every key can be changed in **Settings → Keyboard**:

- Each action and each go-to page has a Change button that captures the next key
  pressed on it. Escape keeps the old key, and leaving the button cancels.
- A key that is already taken, has a modifier, or is not a single character is
  refused, with the reason in a `role="status"` line.
- "Reset to defaults" restores them all.
- The capture stops the key at the button, so no shortcut fires while you choose
  one.
- Letters are matched in lower case, so Caps Lock and Shift do not break a binding.
- The hints, the key list and `aria-keyshortcuts` are all written from the current
  bindings, so a rebind re-labels everything at once.

- **WCAG 2.1.4, character key shortcuts.** Every single-key shortcut can be turned
  off in Settings → Keyboard, which matters for speech input, where dictated words
  would otherwise set keys off. Ctrl+K search has a modifier, so it is outside the
  criterion and stays on.
- **When shortcuts never fire:**
  - while typing in an input, textarea, select or contenteditable, or during IME
    composition;
  - with Ctrl, Meta or Alt held;
  - while any dialog or popover is open (Radix marks both `role="dialog"`), so no
    key acts on the page hidden behind it.
- **The row and column moves shift real focus** to a row's first control: a card's Open button, a
  notification's link, a conversation. A screen reader follows it, and Enter does
  what that control already does. Selection adds no ARIA state of its own. It is
  only how the row holding keyboard focus looks. The open conversation, which is
  current without focus, carries `aria-current="true"`. An Inbox row with neither
  a link nor Mark Read has nothing to act on, and the moves step over it.
- **Selection contrast.** A `.tui-row` holding keyboard focus turns inverse video,
  `primary-foreground` on `primary`, which the tables above measure in every
  palette. Its text re-inks to match, apart from tiles that bring their own surface
  (`.tui-keep`). A focused control inside the row outlines in `primary-foreground`
  rather than the accent: the accent ring on an amber fill is about 1.3:1. Board
  cards keep their `card` surface, since their chips and priority dot are measured
  only against it. They take the accent border (`ring` on `card`) and a 3px cursor
  bar. The bar is decoration everywhere, because the fill or the border carries the
  state. Mouse focus does not select, since the style keys off `:focus-visible`.
  Under forced colours the fill drops, and the system focus outline remains.
- **Hints.** The `[g t]` beside each nav link, the `[w/s] move · …` lines in panel
  borders and under the board, and the status line's `?` are `aria-hidden`. The
  key list says the same in full. All of them disappear while shortcuts are off,
  so none names a dead key. The nav hints take their link's own colour, and the
  panel hints are `muted-foreground` straddling `background` and `card`, like the
  panel titles' meta, so neither adds a new contrast pair.
- **`aria-keyshortcuts`** marks the new-action and search controls with their
  current key, and only while shortcuts are on.

## ⚠️ Re-run this after any palette change

These numbers are current for the terminal palette. Recompute them whenever a
token in `frontend/src/index.css` moves; `ring`, `muted-foreground` and
`destructive-foreground` have the least headroom. The method is sRGB → relative
luminance → `(L1+0.05)/(L2+0.05)`, and the scans are the other half of the
evidence: `E2E_MEMBER_EMAIL=… E2E_MEMBER_PASSWORD=… npx playwright test
e2e/a11y.spec.ts` — 12 scans, six pages in both themes, 0 violations.
