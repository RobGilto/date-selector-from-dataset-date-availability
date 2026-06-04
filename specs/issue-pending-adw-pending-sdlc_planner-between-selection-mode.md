# Feature: Between (date-range) selection mode

## Metadata
issue_number: ``
adw_id: ``
issue_json: ``

## Feature Description

Add a second selection mode to the date controller, switchable from the existing toolbar. In addition to the current single-date pick, users can switch to a "Between" mode where they click a start date and then an end date to choose a contiguous range. The grid highlights every cell between the two endpoints (inclusive). Only dates that exist in the bound dataset are valid endpoints — non-data days remain greyed out and unclickable, exactly as in single-date mode.

Selecting a range writes two ISO `YYYY-MM-DD` values to two distinct App Studio variables (`rangeStart`, `rangeEnd`) so downstream cards can apply a Between filter, mirroring the native App Studio date controller's Between behaviour.

The existing single-date mode and its variable (`functionId` already configured via the settings panel) are unchanged. The new mode adds two more configurable variable function IDs; the settings panel learns to capture and persist them alongside the existing one.

## User Story

As an App Studio page author
I want to drive a Between range filter from the embedded calendar
So that I can offer end users period-based filtering (e.g. *all data between 2024-03-01 and 2024-06-30*) without having to publish a separate native date controller alongside the custom card.

## Problem Statement

Today the card writes exactly one date to one variable. Many downstream cards filter by a *range* (Between operator on a date column), which requires two variables — a start and an end. The user cannot achieve this with the current single-date design without extra page controls. They have explicitly asked for parity with the native card-level Between selector.

## Solution Statement

1. Introduce a `selectionMode: 'single' | 'between'` state. Default `'single'` to preserve current behaviour.
2. Add a mode toggle to the toolbar (two-pill switch, matching the existing `text` / `calendar` view toggle style).
3. In Between mode, the click handler captures the **start** on the first click and the **end** on the second click. A third click resets to a new start. Hovering between clicks shows a preview range. Endpoint validation reuses the existing `availableDates` Set — non-data days remain unclickable.
4. Render-time, every day cell whose ISO date is `>= rangeStart && <= rangeEnd` gets a `.in-range` class. Endpoints get `.range-endpoint`. Existing `.selected` styling is repurposed for the active endpoints; `.in-range` gets a lighter shade.
5. On every committed range (i.e. once both endpoints exist), call `domo.requestVariablesUpdate([{functionId: rangeStartFunctionId, value: startIso}, {functionId: rangeEndFunctionId, value: endIso}])`. Both writes go in a single SDK call so the downstream filter updates atomically.
6. Extend the settings panel to capture **two additional** function IDs (`rangeStartFunctionId`, `rangeEndFunctionId`) alongside the existing one. Persist all three to the same AppDB document (`content.functionId`, `content.rangeStartFunctionId`, `content.rangeEndFunctionId`). Auto-detection (via `onVariablesUpdated` + the page-controls discovery endpoint) populates a multi-select list so the author can map each detected variable to single / range-start / range-end.
7. Persist the selected mode + the last committed range to `sessionStorage` so reloading the card preserves what the user was looking at, mirroring how the current `nab-cal-selected` key works.
8. The header continues to display `YYYY – MMM`. The selected-display pill now shows either a single `YYYY – MMM` or `YYYY – MMM → YYYY – MMM` when a range is committed (en-dash + right-arrow). Title attribute shows raw ISO `YYYY-MM-DD` or `YYYY-MM-DD → YYYY-MM-DD`.

## Relevant Files

Use these files to implement the feature:

- `app/client/src/App.tsx` — single-file component holding all state, toolbar, settings panel, calendar grid, and `selectDate` handler. All UI + state changes happen here. The existing `selectDate`, `availableDates` Set, `formatYMD`, `formatYearMonthLabel`, and `formatIsoToYearMonth` helpers are reused.
- `app/client/src/App.css` — extend with `.in-range`, `.range-endpoint`, `.range-preview` styles. The existing `.toggle-group` / `.toggle-btn` block is reused verbatim for the new mode pills.
- `app/client/public/manifest.json` — collection definition (`nab-date-selector-settings`). Domo AppDB collections store free-form JSON under `content`, so no schema change is strictly required — but for self-documentation, declare two more LONG columns (`rangeStartFunctionId`, `rangeEndFunctionId`) so the manifest documents intent. Existing `id` field (`4896fd53-…`) and dataset alias `sampleData` are unchanged.
- `app/client/public/sample-data.csv` — fixture used by the IS_LOCAL mock. The existing dataset (Jan 2024 → Dec 2024 sparse) is sufficient to test range selection across months and across year boundaries.
- `app/client/README.md` — update the **Local development** + **Configuration** sections to document the two new variable function IDs and the mode toggle. Add a screenshot of the Between selection state if convenient.
- `app/client/index.html` — unchanged. (Dev entrypoint; production publish uses `dist/index.html`.)
- `app/client/vite.config.ts`, `package.json`, `tsconfig.json` — unchanged. No new dependencies.
- `.claude/commands/ship.md` — unchanged but referenced; publish step (`cd app/client/dist && npx ryuu publish`) is what the feature should ultimately be shipped through.
- `specs/v1-iteration-yyyy-mmm-and-between.md` — original customer-facing spec capturing both YYYY-MMM and Between asks. Tick the remaining Between checkboxes after implementation.

### New Files

- `.claude/commands/e2e/test_between_selection.md` — minimal Playwright-driven E2E spec validating: (1) toggle to Between mode, (2) click two in-dataset dates, (3) range cells gain `.in-range`, (4) selected-display pill renders `YYYY – MMM → YYYY – MMM`, (5) two variables receive ISO start + end. Pattern after the in-session playwright-validator runs already used for the YYYY-MMM verification. No `.claude/commands/e2e/` directory exists yet; create it.
- `.claude/commands/test_e2e.md` — top-level runner doc that explains how to execute any file in `.claude/commands/e2e/` against the dev server (`bash scripts/start.sh`) using the `playwright-validator` subagent. One short markdown file with a usage example.

## Implementation Plan

### Phase 1: Foundation

Lock in the data model and validation rules before touching the UI.

- Add a `selectionMode` discriminated state. Default `'single'`. Persist to `sessionStorage` key `cal-mode`.
- Add `rangeStart: string | null` and `rangeEnd: string | null` state. Persist to `cal-range-start` / `cal-range-end`.
- Extend the AppDB document shape to `{ functionId, rangeStartFunctionId, rangeEndFunctionId }`. `loadSettings()` reads all three; `saveSettings()` accepts the full triple. Backwards-compatible: missing fields read as `null` and Range mode disables until the author configures them.
- Add two helpers next to `formatIsoToYearMonth`:
  - `formatRangeLabel(startIso, endIso): string` → `"2024 – Jan → 2024 – Jun"` (en-dash for year-month, right-arrow `→` U+2192 for the connector).
  - `isInRange(iso, startIso, endIso): boolean` → simple lexicographic compare (ISO `YYYY-MM-DD` strings sort correctly as strings).

### Phase 2: Core Implementation

Wire the toggle, click flow, and rendering.

- Add a second `.toggle-group` to the toolbar with two buttons: "Single" / "Between". Active state mirrors existing toggle styling.
- Rewrite `selectDate` to branch on `selectionMode`:
  - `single`: existing behaviour, unchanged.
  - `between`:
    - If `rangeStart === null` OR (both endpoints already set): set `rangeStart = clicked`, clear `rangeEnd`.
    - Else if `clicked < rangeStart`: swap — `rangeStart = clicked`, `rangeEnd = previousStart`.
    - Else: `rangeEnd = clicked`. Commit: `domo.requestVariablesUpdate([{functionId: rangeStartFunctionId, value: rangeStart}, {functionId: rangeEndFunctionId, value: rangeEnd}], ...)`.
- Day-cell `className` builder gains two new classes:
  - `.range-endpoint` when `iso === rangeStart || iso === rangeEnd`.
  - `.in-range` when `isInRange(iso, rangeStart, rangeEnd)` and not an endpoint.
- Add `onMouseEnter` on day cells to set a `hoverDate` state; in Between mode with one endpoint chosen, render the *preview range* between `rangeStart` and `hoverDate` via a `.range-preview` class. Clear on `onMouseLeave` from the grid.
- Toolbar pill now shows:
  - Single mode: existing `formatIsoToYearMonth(selected)`.
  - Between mode: `formatRangeLabel(rangeStart, rangeEnd)` once both are set; otherwise either `"Pick start"` (no endpoints) or `"… → pick end"` (one endpoint).
  - `title` attribute carries the raw ISO equivalents.

### Phase 3: Integration

Hook into settings + publish flow + tests.

- Settings panel: render three labelled rows (Single, Range Start, Range End), each with a number input + a Save button. Detected-variables list now shows three action buttons per row ("Use as Single" / "Range Start" / "Range End") so authors map detected IDs in one click.
- Reset button clears all three IDs and the AppDB doc.
- Add a one-line guard: if `selectionMode === 'between'` but either range function ID is null, render a small banner ("Configure Range Start + Range End in Settings to enable Between mode") and disable the click handler in the grid. Auto-revert to Single mode if the user clears the IDs.
- Update `app/client/public/manifest.json` collection definition to list `rangeStartFunctionId` and `rangeEndFunctionId` columns alongside the existing `functionId`. Keep ADMIN write / USER read permissions.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Prepare the working branch

- Confirm current branch is `yyyy-mmm-update` (the feature branch already pushed to origin). If not, `git checkout yyyy-mmm-update`.
- `git pull --ff-only origin yyyy-mmm-update` to make sure the branch is fresh.
- Run `bash scripts/start.sh` in the background and confirm the dev server is reachable at http://localhost:5173/ before making any code changes.

### 2. Create the E2E scaffold so tests can be written alongside the code

- Create directory `.claude/commands/e2e/`.
- Add `.claude/commands/test_e2e.md` — a short runner doc that documents: invoke the `playwright-validator` subagent with the body of the requested `e2e/test_*.md` as the prompt, against the dev server at `http://localhost:5173/`. Include one usage example.
- Add `.claude/commands/e2e/test_between_selection.md` with the validation steps listed under **Acceptance Criteria** below. Mirror the structure of the in-session playwright validation we used for YYYY-MMM (numbered steps, PASS/FAIL per step, screenshots written to `playwright-reports/`).

### 3. Extend AppDB document shape and settings load/save

- In `App.tsx`, extend `functionIdRef` from `useRef<number | null>(null)` to three refs: `singleFnIdRef`, `rangeStartFnIdRef`, `rangeEndFnIdRef`.
- Update `loadSettings()` to read all three fields out of `docs[0].content`. Missing fields stay null.
- Update `saveSettings(fids: { single?: number; rangeStart?: number; rangeEnd?: number })` to merge into the existing AppDB document via PUT (preserving any fields the caller didn't pass) — never PUT a partial object that wipes the other two.
- Update `resetSettings()` to clear all three.

### 4. Add the mode state + persistence

- Introduce `const [selectionMode, setSelectionMode] = useState<'single' | 'between'>(restoredMode);` with `restoredMode` read from `sessionStorage.getItem('cal-mode')`.
- Introduce `const [rangeStart, setRangeStart] = useState<string | null>(...)`, `const [rangeEnd, setRangeEnd] = useState<string | null>(...)`, `const [hoverDate, setHoverDate] = useState<string | null>(null)`.
- All three storage writes go inside a single `useEffect([selectionMode, rangeStart, rangeEnd])` so we don't sprinkle `sessionStorage.setItem` calls.

### 5. Implement the between-mode click flow in `selectDate`

- Refactor `selectDate(dateStr)` to branch on `selectionMode`. Implement the start/end + swap + commit logic from Phase 2 verbatim.
- The commit path calls `domo.requestVariablesUpdate(updates, success, failure)` with a 3-second `isWritingVar` lockout that already exists for single-date writes.

### 6. Add toggle + range styling

- Add a `<div className="toggle-group mode-toggle">` to the toolbar with two buttons. Active button gets the existing `.active` class.
- Add CSS to `App.css`:
  - `.day.in-range { background: #fde2e4; color: #1a1a2e; }`
  - `.day.range-endpoint { background: #ef3340; color: #fff; border-radius: 6px; }`
  - `.day.range-preview { background: #fef2f3; }`
  - `.mode-toggle { margin-left: auto; }`
- Update the day-cell class builder to compose `selected | has-data | no-data | today | in-range | range-endpoint | range-preview` correctly. Endpoint wins over in-range; in-range wins over preview; no-data dominates everything (still unclickable).

### 7. Update the selected-display pill

- Wrap the pill in a small helper `renderToolbarLabel()` so the conditional rendering (single vs between, complete vs partial range) stays readable.
- Title attribute always carries raw ISO so authors can hover-verify.

### 8. Extend the settings panel

- Render three rows. Each row: label, current value (or "—"), number input, Save button.
- Detected-variable list: each detected entry gets three buttons ("Single", "Range Start", "Range End"). Clicking one calls `saveSettings({ <slot>: v.functionId })`.
- Reset button clears all three.
- Add the banner (step from Phase 3) that nags about missing range IDs when in Between mode.

### 9. Update `manifest.json`

- Add two more LONG columns to the existing collection schema. Keep the existing column. No new permission rows.

### 10. Validate locally end-to-end

- Reload http://localhost:5173/. Toggle to Between mode. Pick two in-dataset days. Confirm:
  - Range cells highlight (background, lighter shade).
  - Endpoints get red highlight.
  - Pill reads `YYYY – MMM → YYYY – MMM`.
  - Title attribute reads `YYYY-MM-DD → YYYY-MM-DD`.
  - Refreshing the page restores the same mode + range from sessionStorage.
- Test the swap case: pick a start, then click an earlier date. The earlier date should become start, original click should become end.
- Test the third-click reset: with both endpoints set, click a third date. State should reset to that date as the new start with no end.
- Test the missing-config guard: open settings, clear range start ID, switch to Between mode. Confirm the banner appears and clicks in the grid are no-ops.

### 11. Run the new E2E

- Read `.claude/commands/test_e2e.md`, then read and execute the new `.claude/commands/e2e/test_between_selection.md` test file via the `playwright-validator` subagent against http://localhost:5173/. All numbered steps must PASS.

### 12. Build and publish a preview

- `cd app/client && npm run build`. Expect zero errors.
- (Optional, only if you want to validate on `nab-au.domo.com` before merging): `cd app/client/dist && npx ryuu publish`. Visually confirm Between mode works in App Studio. Roll back by re-publishing from `main` if anything regresses.

### 13. Run the Validation Commands below

## Testing Strategy

### Unit-style checks (lightweight, no test runner introduced)

- `formatRangeLabel('2024-01-15', '2024-06-30')` → `'2024 – Jan → 2024 – Jun'`.
- `isInRange('2024-03-15', '2024-01-01', '2024-06-30')` → true.
- `isInRange('2023-12-31', '2024-01-01', '2024-06-30')` → false.
- `isInRange('2024-01-01', '2024-01-01', '2024-06-30')` → true (inclusive start).
- These can live as a `// dev sanity check` inside `App.tsx` behind `if (IS_LOCAL) { console.assert(...) }` so the production bundle stays clean.

### Edge Cases

- Same start and end (single-day range): both writes carry the same date. Must not crash. Pill renders `YYYY – MMM` (collapsed when start === end).
- Start clicked, then user toggles back to Single mode mid-flow: discard `rangeStart`/`rangeEnd` state; existing `selected` is preserved.
- Hover preview when the cursor is on a no-data day: preview range still computes (intervening days highlight), but the no-data day itself does not get the preview class — it stays `no-data`.
- Cross-year range (e.g. `2024-12-15 → 2025-02-01`): grid view shifts as the user navigates months; the highlight persists across months.
- Network/AppDB failure during `saveSettings`: error is logged, panel does not optimistically claim success.

## Acceptance Criteria

- [ ] Mode toggle (Single | Between) renders in the toolbar and persists across reloads.
- [ ] Between mode allows two-click range selection limited to in-dataset endpoints.
- [ ] Range cells render with a lighter highlight; endpoints render with the existing selected style.
- [ ] Hover preview appears after the first click and disappears after the second click commits.
- [ ] Selected-display pill renders `YYYY – MMM → YYYY – MMM` once both endpoints are set; `title` carries raw ISO.
- [ ] Two App Studio variables receive ISO `YYYY-MM-DD` values atomically (one `requestVariablesUpdate` call).
- [ ] Settings panel captures and persists three function IDs in the AppDB collection; auto-detected variables can be assigned to any slot in one click.
- [ ] Missing range IDs disable Between mode with an inline banner.
- [ ] Single-date mode behaviour and its variable wiring are unchanged (no regressions in the existing functionId 131272 path).
- [ ] `specs/v1-iteration-yyyy-mmm-and-between.md` remaining checkboxes are ticked.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `cd app/client && npx tsc --noEmit` — must compile clean.
- `cd app/client && npm run build` — must build without errors.
- `cd app/client && grep -n "selectionMode\\|rangeStartFunctionId\\|rangeEndFunctionId\\|formatRangeLabel\\|isInRange" src/App.tsx` — must return at least 12 hits (declarations + call sites).
- `cd app/client && jq -e '.collectionsMapping[0].schema.columns | map(.name) | contains(["functionId","rangeStartFunctionId","rangeEndFunctionId"])' public/manifest.json` — must return `true`.
- `bash scripts/start.sh` then walk through the manual flow in step 10 above.
- Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_between_selection.md` — every numbered step must PASS.
- `cd app/client && grep -rn "May 2024\\|Jun 2024" src/App.tsx` — must return zero matches (we never render month names without a year prefix; this catches accidental regressions of the YYYY – MMM format).
- Manual screenshot capture of: (a) Between mode toggle pill, (b) two-endpoint highlighted range, (c) selected-display pill rendering `YYYY – MMM → YYYY – MMM`. Save under `playwright-reports/<date>_between/`.

## Notes

- No new npm dependencies. ISO date string comparison handles all logic (lexicographic ordering of `YYYY-MM-DD` is monotonic). Avoid pulling in `date-fns` or `luxon` — every helper this feature needs is one line of vanilla TS.
- Domo AppDB `content` is free-form JSON; manifest column declarations are only used for indexed query fields. We could ship the three function IDs without manifest changes, but declaring them keeps the schema self-documenting and lets future ADW agents grep the manifest to discover the contract.
- The two new function IDs on the customer side (`vRangeStart`, `vRangeEnd` in the legacy spec) must be created in App Studio by the page author before Between mode is usable. The auto-detect flow (existing `onVariablesUpdated` + `discoverViaPageControls`) surfaces them in the settings panel the moment the page emits them.
- The selected-display pill could overflow on narrow cards. Existing CSS already applies `text-overflow: ellipsis`; the `→` character is narrow so most reasonable card widths render the full label. If needed, fall back to vertically stacking start/end on a follow-up iteration — out of scope here.
- Memory crosslink: existing customer-facing requirements doc lives at `specs/v1-iteration-yyyy-mmm-and-between.md`; tick its remaining checkboxes after this lands.
- After implementation, push to a follow-up branch (e.g. `between-selection`) off of `yyyy-mmm-update` so the change can be reviewed independently rather than piling onto an already-open PR.
