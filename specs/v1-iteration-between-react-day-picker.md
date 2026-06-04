# Spec v1 — Between mode via react-day-picker

**Source:** Customer email 2026-05-19 (Digvijay Moray, NAB) + prior failed attempt + UX research 2026-05-22 (NN/g, Smashing Magazine, PatternFly).
**Case:** 05930295
**Target:** `app/client/`
**Supersedes "Between selection mode" portion of:** `specs/v1-iteration-yyyy-mmm-and-between.md`

## Why a rewrite

Prior hand-rolled grid attempt did not ship. Symptoms (inferred): two separate from/to inputs, no range visualization, dropped first click, no presets. Replace bespoke grid with `react-day-picker` v9 in `mode="range"` — battle-tested two-tap range UX, ~15KB.

## Stack additions

```bash
cd app/client && npm i react-day-picker@^9 date-fns@^3
```

`date-fns` already a transitive of react-day-picker; pin top-level for `format()`.

## Component contract

`<DateController />` (replaces current `App.tsx` calendar grid).

Props (driven by AppDB collection `nab-date-selector-settings`):

| Field | Type | Notes |
|---|---|---|
| `mode` | `'single' \| 'between'` | persisted via `domo.get` AppDB |
| `singleVarFunctionId` | `number` | default `131272` (`vTillSelectedMonth`) |
| `rangeStartFunctionId` | `number` | TBD — confirm with Digvijay before merge |
| `rangeEndFunctionId` | `number` | TBD |
| `datasetAlias` | `string` | default `SampleData` |
| `dateColumn` | `string` | default `Date` |

## UX requirements

### Mode toggle
Segmented control above calendar: `[Single date | Between]`. Selected mode persists to AppDB. Default = `single` (no regression).

### Header format
Caption renders `YYYY – MMM` (en-dash + 3-letter month). Customize via `formatters.formatCaption` prop:

```ts
formatCaption: (date) => `${date.getFullYear()} – ${format(date, 'MMM')}`
```

### Data-driven disabled days
Fetch dataset dates once via `domo.get('/data/v1/' + alias + '?fields=' + col)`, build `Set<string>` of ISO dates. Pass to `<DayPicker disabled={(d) => !available.has(toISO(d))} />`.

### Single mode
- `mode="single"` — one click selects, fires `domo.requestVariablesUpdate(singleVarFunctionId, isoDate)` immediately (matches v1 behavior).
- Status pill below calendar: `Selected: 2026 – May – 17`.

### Between mode
- `mode="range"` — two-tap. First tap = start, second = end. Third tap restarts from new start.
- Hover preview between first and second tap (built-in).
- Disabled (no-data) days NOT clickable as endpoints; interior gaps of selected range stay highlighted (range = inclusive bounds; gaps acceptable, matches Domo card filter "Date Between").
- **Apply / Clear** buttons appear after start picked. Apply fires both `requestVariablesUpdate` calls in parallel; Clear resets local state without touching App Studio.
- Status text rotates:
  - no start → `Pick start date`
  - start picked, no end → `Pick end date`
  - both → `2026 – May – 03 → 2026 – May – 17 (15 days)`

### Presets (between mode only)
Row of pill buttons under calendar — populate from dataset bounds:
- `This month`
- `Last 30 days`
- `Year to date`
- `All data` (min..max of dataset)

Clicking preset stages range locally; user still presses Apply (lets them tweak before firing).

### Two-month desktop, one-month mobile
`<DayPicker numberOfMonths={isWide ? 2 : 1} />` with `useMediaQuery('(min-width: 720px)')`. Domo card iframes vary; breakpoint conservative.

### Keyboard
react-day-picker v9 ships full keyboard support (arrows, Enter, Esc). No extra work.

## App Studio variable contract

| Mode | Writes |
|---|---|
| `single` | `vTillSelectedMonth` (131272) on every click |
| `between` | `vRangeStart` + `vRangeEnd` on Apply only — never partial |

Switching modes does NOT clear the other side's last value (App Studio cards reading the old variable keep working).

## Out of scope (v1)

- Localized month names beyond English (en-AU acceptable since NAB is AU).
- Cross-year ranges > 24 months (allowed, no perf optimization).
- Custom theming beyond Domo's default font stack (override `--rdp-accent-color` to Domo blue `#0091F7`).
- Editing variable functionIds via UI (still hard-coded in AppDB settings; editor panel separate spec).

## Acceptance

- [x] `npm i react-day-picker@^9 date-fns@^3` clean install (v9.14.0 + date-fns v4.1.0)
- [x] Mode toggle visible, persists across reload via AppDB (`switchSelectionMode` auto-saves)
- [x] Caption renders `YYYY – MMM` with en-dash (via `formatters.formatCaption`)
- [x] `disabled` days unclickable, dimmed (css `--rdp-disabled-opacity: 0.25`, `cursor: not-allowed`)
- [x] Single mode click → fires `requestVariablesUpdate(131272, iso)` immediately
- [x] Between mode: two-tap range with hover preview, third tap restarts (rdp built-in)
- [x] Apply fires both range variables; Clear resets `rangeSelected` without firing variable
- [x] Presets: This month / Last 30d / YTD / All data — filtered to non-empty; each stages range
- [x] Two months side-by-side ≥720px via `useMediaQuery`; single month <720px
- [x] Status text: `Pick start date` → `Pick end date` → `start → end (N days)`
- [x] Keyboard navigation: rdp v9 built-in (arrows + Enter + Esc)
- [x] `npm run build` passes with zero TS errors (280.72 kB bundle)
- [x] IS_LOCAL CSV mock drives calendar (no `domo.get` in dev path)

## Anti-patterns explicitly avoided

| Don't | Why |
|---|---|
| Two separate From/To input fields | Smashing study — bounces between pickers, loses range viz |
| Fire variable update on every interior tap during range pick | Triggers App Studio re-render storm |
| Allow end < start | Invalid state; rdp prevents this in `mode="range"` |
| Snap endpoints to nearest available date silently | User confusion; instead reject + toast |
| Reset on outside-click before range complete | Smashing study — looks broken |

## Open questions for customer (before final merge)

1. Confirm `vRangeStart` / `vRangeEnd` functionIds — or should we auto-create on first Apply?
2. Preset list — is `[This month, Last 30d, YTD, All data]` the right shortlist? Card filter uses different defaults?
3. Inclusive vs exclusive end date for "Between" — customer's existing card filter semantics?

## References

- Airbnb `react-dates` (pattern source, not used as dependency)
- react-day-picker docs: https://daypicker.dev/
- PatternFly Date Picker design guideline
- Smashing Magazine "Designing The Perfect Date And Time Picker" (2017)
- NN/g "Date-Input Form Fields: UX Design Guidelines"
- Search cache: `.firecrawl/search-between-ux.json`
