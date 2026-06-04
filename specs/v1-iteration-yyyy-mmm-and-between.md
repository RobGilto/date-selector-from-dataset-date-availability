# Spec v1 — Iteration: YYYY-MMM format + "Between" selection

**Source:** Customer email 2026-05-19 (Digvijay Moray, NAB)
**Case:** 05930295
**Target:** `app/client/`

## Context

V1 prototype (in `app/client/src/App.tsx`) renders a calendar grid; only days present in `SampleData.Date` are clickable. Click writes selected date to App Studio variable `vTillSelectedMonth` (functionId 131272).

Customer requested two additions after stakeholder review.

## Requirement 1 — Date label format `YYYY-MMM`

- Month header in calendar should render as e.g. `2026 – May` (en-dash + 3-letter month).
- Where today's display reads `May` / `May 2026`, switch to `2026 – May`.
- Selection-pill / variable readout (if shown) also `YYYY-MMM`.
- The underlying variable value stays an ISO date (`YYYY-MM-DD`) — only display changes.

## Requirement 2 — "Between" selection mode

- Add a toggle (single-date | between).
- In "between" mode: user clicks a start date, then an end date. Range highlight between.
- Only dates present in the dataset are selectable as endpoints.
- Drive two App Studio variables:
  - `vRangeStart` — functionId TBD (ask customer or read from manifest)
  - `vRangeEnd` — functionId TBD
- Single-date mode keeps current variable `vTillSelectedMonth` (131272) behavior.

## Out of scope (v1)

- Localizing month names beyond English.
- Cross-year ranges spanning > 12 months (still allowed, no perf optimization).
- Bug-fixing the variable-action issue from the original case (separate spec).

## Acceptance

- [x] Calendar header reads `YYYY – MMM` (en-dash).
- [ ] Toggle UI for single | between mode.
- [ ] Between mode highlights inclusive range and only allows in-dataset endpoints.
- [ ] Two new App Studio variable writes wire to provided functionIds.
- [ ] No regression in v1 single-date selection.
- [ ] `npm run build` passes with no TS errors.
