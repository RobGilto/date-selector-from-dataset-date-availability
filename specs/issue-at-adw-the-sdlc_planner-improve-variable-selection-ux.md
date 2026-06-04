# Feature: Improve variable-selection UX — guided settings + commit-on-Apply for range

## Metadata
issue_number: `at`
adw_id: `the`
issue_json: `UI`

## Feature Description

Today the Settings panel exposes three labelled number-input rows ("Single date variable", "Range start variable", "Range end variable") and asks the user to paste raw Function IDs into each. This is a developer-facing form leaking into a user-facing surface. Most App Studio authors don't know what a Function ID is, can't tell which variable on their page is "start" vs "end", and there is no in-calendar feedback connecting the chosen variable to the date they're picking.

Additionally, in Between mode the second click *auto-commits* both variable writes. Authors who mis-click can't preview their selection before it propagates to downstream cards.

This feature reworks the variable-selection UX along two axes:

1. **Settings panel — guided binding, not raw IDs.** Replace the three free-text inputs with a single guided picker. List all variables detected on the page (already discovered by the existing `onVariablesUpdated` listener + page-controls endpoint). For each detected variable, render a chip showing the variable's display name plus a small "Assign to → [Single | Range Start | Range End]" dropdown. The raw Function ID becomes a copy-only hint shown beneath each chip. Manual numeric entry is moved into a collapsible "Advanced" disclosure that defaults to hidden.

2. **Calendar — pick, preview, then Apply.** In Between mode, two clicks now stage a *pending* range (highlighted in calendar, summarised in toolbar pill) but do not write to the App Studio variables until the user explicitly commits via an `Apply` button (or presses `Enter` while the brick has keyboard focus). A second `Esc` / `Cancel` button discards the staged range and restores the last committed range. Single mode keeps its current one-click commit (no behaviour change there).

The result: authors configure the brick once by picking detected variables from a friendly list — no Function IDs visible. End users in Between mode get an explicit preview-then-commit gesture that mirrors how native App Studio date controllers work.

## User Story

As an App Studio page author configuring the brick for the first time
I want to bind detected page variables to "single", "range start", and "range end" slots from a guided list of variable names
So that I never have to look up or paste raw Function IDs.

As an end user picking a date range in Between mode
I want to pick a start date and an end date, see the range previewed, and then explicitly commit it with `Apply` (or Enter)
So that I can correct a mis-click before downstream cards refresh.

## Problem Statement

The current settings UI forces users to think in Function IDs (an internal Domo platform concept), and the current Between flow commits range writes immediately on the second click with no preview/undo. Both make the brick harder to adopt than the native App Studio date controller it replaces.

## Solution Statement

Two surgical UX changes layered on top of the existing data model (no schema change in AppDB; the three-slot `SettingsContent` shape stays):

1. **Settings panel rebuild** — drive the panel from the existing `detected` array (DetectedVar list already populated by `onVariablesUpdated` + page-controls discovery). For each detected variable render one chip; the chip has a "Bind to" selector with the three slot options. Save on selection. Show the current assignment status above the chip list ("Currently: Single → vTillSelectedMonth · Start → unset · End → unset"). The number-input form moves behind a collapsible `<details>` advanced block.
2. **Apply-to-commit for range mode** — introduce `pendingRangeStart`, `pendingRangeEnd`, and `committedRangeStart`, `committedRangeEnd` state. Calendar clicks in Between mode mutate the *pending* pair only. The toolbar gains an "Apply" button (also wired to the `Enter` key via a keydown handler on the brick root) and a "Cancel" button. Apply: copies pending → committed, fires `domo.requestVariablesUpdate` for both range variables, persists committed to sessionStorage. Cancel: drops pending, leaves committed (and the App Studio variables) untouched. Single mode keeps its existing one-click immediate commit.

No new dependencies. No new AppDB columns. Existing helpers (`formatRangeLabel`, `isInRange`, etc.) are reused unchanged.

## Relevant Files

Use these files to implement the feature:

- `app/client/src/App.tsx` — single-file component holding all settings + calendar state, the existing detected-vars list, the `selectDate` handler, the Settings panel JSX, and the toolbar. Every change in this feature lives here.
- `app/client/src/App.css` — extend with `.settings-chip-row`, `.settings-chip`, `.settings-chip-meta`, `.settings-advanced`, `.toolbar-actions`, `.btn-apply`, `.btn-cancel`, `.range-pending` styles. The existing `.range-endpoint`, `.in-range`, `.range-preview`, `.mode-toggle`, and `.settings-slot` styles are reused or retired in favour of the new chip layout.
- `app/client/public/manifest.json` — unchanged. Collection schema already declares `functionId`, `rangeStartFunctionId`, `rangeEndFunctionId`. No new columns.
- `app/client/public/sample-data.csv` — IS_LOCAL fixture; the existing sparse 2024 dataset is enough to validate.
- `app/client/README.md` — update **Configuration** section to describe the new chip-based binding flow and the Apply/Cancel/Enter range commit gesture. Keyboard shortcut documentation belongs here too.
- `specs/issue-pending-adw-pending-sdlc_planner-between-selection-mode.md` — the spec that introduced Between mode. Cross-link from the new spec so future readers see the progression: Between mode landed first; this feature refines its UX.
- `specs/v1-iteration-yyyy-mmm-and-between.md` — original customer-facing spec; once Apply lands, note the UX improvement in a follow-up acceptance line.
- `.claude/commands/ship.md` — publish flow doc; unchanged but referenced when shipping the improvement to `nab-au.domo.com`.

### New Files

- `.claude/commands/e2e/test_variable_binding_ux.md` — minimal Playwright-driven E2E spec validating: (1) Settings panel renders detected variables as chips with bind dropdowns, (2) selecting "Range Start" in a chip dropdown persists, (3) numeric inputs are hidden behind a collapsed `<details>` element by default, (4) range mode shows Apply/Cancel buttons after two clicks, (5) Apply fires `requestVariablesUpdate` (spy via window.__variableUpdates), (6) Cancel reverts pending. Pattern after the existing in-session playwright validation in `playwright-reports/2026-05-20_02-19-41/`.
- `.claude/commands/test_e2e.md` — short runner doc (created in the previous Between-mode spec but never committed); short markdown documenting how to invoke the `playwright-validator` subagent against `http://localhost:5173/` with any `.claude/commands/e2e/test_*.md` file as the prompt body. One usage example.
- `.claude/commands/e2e/` — directory must exist; create if absent.

## Implementation Plan

### Phase 1: Foundation

Lock in the new state model before touching JSX.

- Split the existing single `rangeStart` / `rangeEnd` state into two pairs: `pendingRangeStart`, `pendingRangeEnd` (drive in-calendar highlight + toolbar preview) and `committedRangeStart`, `committedRangeEnd` (mirror the values currently written to App Studio variables; used to restore on Cancel and to render `range-endpoint` once committed).
- Add a derived `rangeIsDirty` boolean: `pendingRangeStart !== committedRangeStart || pendingRangeEnd !== committedRangeEnd`.
- Add a top-level `onKeyDown` handler on the root `.app` div that triggers `applyPendingRange()` on `Enter` (only when `selectionMode === 'between'` and `rangeIsDirty`) and `cancelPendingRange()` on `Escape`. Use a `tabIndex={0}` on the root so it can receive focus.

### Phase 2: Core Implementation

Implement the two UX changes.

#### Settings panel rebuild

- Compute `currentAssignments`: `{ single: singleFnIdRef.current, rangeStart: rangeStartFnIdRef.current, rangeEnd: rangeEndFnIdRef.current }`. Render a one-line summary at the top of the panel: `Single → <variable name or "—"> · Range start → <…> · Range end → <…>`.
- Render one chip per `detected` entry. Chip layout: variable name (large), `<select>` with options `["Unassigned", "Single", "Range start", "Range end"]`. The selected option reflects whichever slot the variable's Function ID currently occupies. Changing the dropdown calls `saveSettings({ <slot>: v.functionId })` or `{ <slot>: null }` (unassign).
- Below each chip, render `<small className="settings-chip-meta">functionId: {v.functionId}</small>` so the raw ID stays accessible.
- Wrap the existing numeric input rows + discovery snippet in a single `<details className="settings-advanced">` block titled "Advanced — paste Function IDs manually". Defaults to closed. The discovery snippet copy-button stays inside.
- Remove the separate "Detected on this page — assign to a slot" section; the chip list replaces it.
- Empty-state: if `detected.length === 0` and no slot is currently bound, render a friendly empty message ("No variables detected yet. Open the Advanced section or refresh the page once the App Studio variables are configured.") plus a "Refresh detection" button calling `discoverViaPageControls()` directly.

#### Apply-to-commit for range mode

- Rewrite the Between branch of `selectDate(dateStr)`:
  - First or third click (pending pair empty or both pending values set, regardless of `rangeIsDirty`): `setPendingRangeStart(dateStr); setPendingRangeEnd(null);`
  - Second click (`pendingRangeStart !== null && pendingRangeEnd === null`): sort against the existing start, set both pending values. **Do not fire `requestVariablesUpdate` yet.**
- New `applyPendingRange()`:
  - Returns early if `pendingRangeStart === null || pendingRangeEnd === null`.
  - Returns early with a console warn if both range Function IDs are not configured.
  - Calls `domo.requestVariablesUpdate(...)` with both writes in a single call (existing pattern).
  - On the success callback, copy pending → committed and persist `committedRangeStart`/`committedRangeEnd` to sessionStorage keys `cal-range-start` / `cal-range-end` (replacing the current keys' meaning — they now store *committed* values).
- New `cancelPendingRange()`:
  - Restores `pendingRangeStart = committedRangeStart`, `pendingRangeEnd = committedRangeEnd`.
- Toolbar gains two buttons that only render when `selectionMode === 'between'`:
  - `Apply` — disabled unless `rangeIsDirty && pendingRangeStart && pendingRangeEnd`.
  - `Cancel` — disabled unless `rangeIsDirty`.
  - Render them inline next to (or below, depending on width) the mode toggle. Mobile-friendly: stack vertically when toolbar narrow.
- Toolbar pill rendering in Between mode now branches on both `rangeIsDirty` and which pending value is set:
  - No pending start: "Pick start".
  - Pending start, no pending end: `<YYYY – MMM> → pick end`.
  - Pending start + end, dirty: `<YYYY – MMM> → <YYYY – MMM>` with a small `(unapplied)` suffix in muted colour.
  - Pending start + end, not dirty (just committed): `<YYYY – MMM> → <YYYY – MMM>` (no suffix).
- Calendar grid class composition gains one more class: `range-pending` for cells inside the *pending but not yet committed* range. Visually: the same light-pink as `in-range` but with a dashed border so the user can tell the range is staged, not live.

### Phase 3: Integration

- The existing `discoverViaPageControls()` 404 fallback is unchanged. The chip list naturally handles an empty `detected` array via the empty-state copy.
- The existing `auto-adopt` effect (binds first detected date-shaped variable into the Single slot) is preserved but logs a one-time message "Auto-bound first detected variable to Single. Change in Settings if needed." Surface this as a small dismissible banner *only on the first auto-bind*.
- Keep the existing manual-entry path alive (in Advanced disclosure) so power users / debugging sessions can still paste IDs. Saving from Advanced reuses `saveSettings(patch)`.
- README update: document chip flow, Apply/Cancel/Enter/Esc shortcuts, and the Advanced disclosure escape hatch.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Prepare working branch

- `git status` — confirm we are on the `yyyy-mmm-update` branch (the Between feature is still uncommitted on this branch).
- Commit the in-progress Between work to a new branch first: `git checkout -b between-selection && git add app/client/src/App.tsx app/client/src/App.css app/client/public/manifest.json specs/issue-pending-adw-pending-sdlc_planner-between-selection-mode.md && git commit -m "feat: between (range) selection mode"`. Push to origin so the previous feature is preserved as its own branch.
- Branch this UX-improvement work off the Between commit: `git checkout -b variable-binding-ux`.

### 2. Create the E2E scaffold

- Create directory `.claude/commands/e2e/` if it doesn't exist.
- Add `.claude/commands/test_e2e.md` — short runner doc with one usage example invoking the `playwright-validator` subagent.
- Add `.claude/commands/e2e/test_variable_binding_ux.md` covering: (a) Settings chip rendering, (b) chip dropdown bind, (c) Advanced disclosure default-closed, (d) Apply enables only when range is dirty + complete, (e) Apply fires variable update (assert via a Playwright `window.__lastVariableUpdate` spy installed in IS_LOCAL mode), (f) Cancel reverts.

### 3. Add a local-dev variable-update spy

- In `App.tsx`, wrap `domo.requestVariablesUpdate` calls so that when `IS_LOCAL`, the payload is also assigned to `window.__lastVariableUpdate` (typed as `any`). Production builds skip this hook because the wrapper is no-op when `IS_LOCAL === false`. This keeps the implementation small and lets the Playwright E2E assert against actual writes without needing a Domo iframe.
- Document the spy in a one-line code comment so future readers don't think it leaks into production. (It doesn't — `IS_LOCAL` is `false` when hostname isn't localhost.)

### 4. Refactor state model

- Rename `rangeStart` / `rangeEnd` to `committedRangeStart` / `committedRangeEnd`.
- Introduce `pendingRangeStart` / `pendingRangeEnd` state, initialised from sessionStorage (`cal-range-start`, `cal-range-end`) so a reload preserves the last committed range, with pending = committed at mount.
- Update the sessionStorage `useEffect`s to write only the *committed* pair. Pending values are not persisted (they reset on reload — intentional, mirrors App Studio behaviour).
- Add the `rangeIsDirty` derived value.

### 5. Implement `applyPendingRange()` and `cancelPendingRange()`

- New named functions inside the component. Both close over current pending + committed state via `useCallback`.
- Wire them into the toolbar Apply / Cancel buttons (Phase 2).

### 6. Wire keyboard shortcuts

- Add `tabIndex={0}` to the root `.app` div so it can receive focus.
- Add an `onKeyDown` handler: `Enter` → `applyPendingRange()` (only when between + dirty + complete); `Escape` → `cancelPendingRange()` (when between + dirty). Stop propagation so the keys don't bubble into the Domo host page.
- On mount, focus the root if `IS_LOCAL` (handy for local QA); skip in production to avoid stealing focus from the host page.

### 7. Rewrite `selectDate` Between branch

- First or third click: set pending start, clear pending end.
- Second click: sort and set both pending values. Do not call `requestVariablesUpdate`.
- Keep Single mode unchanged.

### 8. Rebuild the Settings panel

- Render `currentAssignments` summary at the top.
- Render one chip per detected variable with a Bind dropdown. Wire dropdown changes to `saveSettings(...)`.
- Wrap the existing numeric inputs + discovery snippet + Reset button inside `<details className="settings-advanced"><summary>Advanced — paste Function IDs manually</summary>...</details>`.
- Add the empty-state copy + "Refresh detection" button.
- Remove the now-redundant per-detected-variable Single/Start/End button trio (the chip dropdown replaces it).

### 9. Update the calendar grid

- Compose day-cell classes: `range-endpoint` for committed endpoints, `in-range` for cells in the committed range, `range-pending` for cells in the pending range that aren't also in committed (dashed border, lighter pink), `range-preview` for hover preview. Endpoint > committed > pending > preview > today.

### 10. Update the toolbar pill

- New `renderToolbarLabel()` covering all four pending-state cases listed under Phase 2.
- Render Apply / Cancel buttons in a `.toolbar-actions` flex group, only visible in Between mode.

### 11. Add CSS

- New classes: `.settings-chip-row`, `.settings-chip`, `.settings-chip-meta`, `.settings-advanced > summary`, `.toolbar-actions`, `.btn-apply`, `.btn-cancel`, `.range-pending`.
- Reuse the existing brand red (`#ef3340`) for Apply, soft grey for Cancel.
- Hide the old `.settings-slot` styles or repurpose them inside Advanced.

### 12. README update

- Document chip-based binding under **Configuration**.
- Document keyboard shortcuts (`Enter` to apply, `Esc` to cancel) under a new **Keyboard shortcuts** section.
- Note the Advanced disclosure as the escape hatch for users who need raw Function ID entry.

### 13. Manual validation

- `bash scripts/start.sh`, open http://localhost:5173/.
- Verify: Settings opens with a chip list (or empty-state message). Advanced section collapsed by default. Bind one detected variable as Single; confirm summary line updates.
- Switch to Between mode. Use the Advanced section to manually paste two Function IDs as Range start / Range end (the local-dev fallback). Pick two dates. Confirm:
  - Pending cells render with `.range-pending` (dashed light pink).
  - Toolbar shows `Apply` and `Cancel`.
  - Toolbar pill shows `(unapplied)` suffix.
  - Press `Enter`. Confirm:
    - `.range-pending` cells switch to `.in-range`.
    - Endpoints get `.range-endpoint`.
    - `(unapplied)` suffix disappears.
    - `window.__lastVariableUpdate` contains both functionId/value pairs.
- Pick two new dates → press `Escape` → confirm pending reverts to the previous committed range and the variable spy did not fire again.

### 14. Run the new E2E

- Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_variable_binding_ux.md` via the `playwright-validator` subagent against http://localhost:5173/. All numbered steps must PASS.

### 15. Build + (optional) publish

- `cd app/client && npm run build`. Zero errors expected.
- Optionally: `cd app/client/dist && npx ryuu publish` to validate on `nab-au.domo.com` against the existing design id.

### 16. Run the Validation Commands below

## Testing Strategy

### Unit-style checks (inline `console.assert` under `if (IS_LOCAL)`):

- `applyPendingRange()` no-ops when pending is incomplete.
- `applyPendingRange()` no-ops when range Function IDs are not configured (warn logged).
- `cancelPendingRange()` restores the prior committed pair.
- Pending → committed copy fires `requestVariablesUpdate` exactly once per Apply.
- Switching mode mid-pending discards pending (preserves committed).

### E2E (Playwright-driven, via `.claude/commands/e2e/test_variable_binding_ux.md`)

- Settings chip list renders one chip per detected variable. (In local dev, fall back to manually inserting a stubbed `DetectedVar` via `window.__injectDetectedVar` — to be added behind `IS_LOCAL` for the test).
- Selecting "Range Start" in a chip dropdown persists across a settings panel close + reopen.
- `<details className="settings-advanced">` is closed on first open.
- Apply button is disabled until pending range is complete + dirty.
- Cancel button resets pending to committed.
- `Enter` keystroke commits; `Esc` cancels.
- The spy `window.__lastVariableUpdate` reflects the committed range after Apply, not before.

### Edge Cases

- User Applies a pending range with only one endpoint set (Apply must stay disabled — guard).
- User reverts mode to Single while a pending range is dirty (drop pending, preserve committed).
- User edits a chip binding while a pending range is dirty (binding change does not retroactively re-fire the App Studio writes; user must Apply again).
- Detected variables list updates after a chip is already mounted (chip list re-renders without losing the user's mid-edit dropdown state — debounce or key by `functionId`).
- Saved Function ID no longer matches any detected variable (chip list shows "Not currently emitted: <functionId>" entry so user can unassign).
- Apply while not in Between mode is a no-op (button only renders in Between).
- Domo `requestVariablesUpdate` returns an error — show inline toast inside the toolbar; do not copy pending → committed.

## Acceptance Criteria

- [ ] Settings panel renders detected variables as chips with bind dropdowns; manual numeric inputs are hidden behind a collapsed Advanced disclosure.
- [ ] Current assignments are summarised on a single line at the top of the panel using variable display names (not raw Function IDs).
- [ ] Auto-binding the first detected date-shaped variable to Single still works and surfaces a one-time dismissible banner.
- [ ] In Between mode, two calendar clicks stage a *pending* range visualised with `.range-pending` (dashed light pink). No App Studio variable write occurs until Apply.
- [ ] Toolbar gains `Apply` and `Cancel` buttons in Between mode. Apply is disabled until pending is complete + dirty. Cancel is disabled when not dirty.
- [ ] `Enter` keystroke triggers Apply; `Esc` triggers Cancel (both only when Between mode + dirty).
- [ ] Apply fires exactly one `domo.requestVariablesUpdate` carrying both range Function IDs/values, then promotes pending → committed and persists to sessionStorage.
- [ ] Single mode behaviour and its variable wiring are unchanged (no regressions in the existing Single flow).
- [ ] README documents the new chip flow + keyboard shortcuts.
- [ ] `cd app/client && npm run build` passes with zero TypeScript errors and no new warnings beyond the pre-existing CJS-API deprecation notice.
- [ ] `.claude/commands/e2e/test_variable_binding_ux.md` runs PASS end-to-end against `http://localhost:5173/` via the `playwright-validator` subagent.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `cd app/client && npx tsc --noEmit` — TypeScript must compile clean.
- `cd app/client && npm run build` — Vite production build must finish without errors.
- `cd app/client && grep -n "pendingRangeStart\\|committedRangeStart\\|applyPendingRange\\|cancelPendingRange\\|settings-chip\\|range-pending" src/App.tsx | wc -l` — must return ≥ 18 hits (state, helpers, refs, JSX, classes).
- `cd app/client && grep -n "settings-advanced" src/App.tsx` — must include both the `<details>` wrapper and the `<summary>` element.
- `cd app/client && grep -c "requestVariablesUpdate" src/App.tsx` — must equal exactly **2** (one Single-mode immediate commit, one Apply-driven Range-mode commit). Any additional call indicates the range branch still has its own auto-commit path that should have been removed.
- `cd app/client && grep -n "tabIndex" src/App.tsx` — must show the root `.app` div with `tabIndex={0}`.
- `cd app/client && grep -n "__lastVariableUpdate" src/App.tsx` — must include the `IS_LOCAL`-gated spy assignment.
- `cd app/client && jq -e '.collectionsMapping[0].schema.columns | map(.name) | contains(["functionId","rangeStartFunctionId","rangeEndFunctionId"])' public/manifest.json` — must return `true` (no manifest regression).
- `bash scripts/start.sh` (or `/start`) then walk the manual flow in step 13.
- Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_variable_binding_ux.md` — every numbered step must PASS.
- (Optional but recommended) `cd app/client/dist && npx ryuu publish` and validate the chip-based settings panel + Apply gesture in App Studio on `nab-au.domo.com` against the existing design id `4896fd53-0232-42d3-b31b-7be12b50e6ed`.

## Notes

- No new npm dependencies. No new Domo collection columns. No new App Studio variables. Existing schema is sufficient.
- The chip dropdown intentionally uses a native `<select>` rather than a custom component to keep the bundle small and the keyboard / screen-reader UX honest.
- Persisting *committed* range to sessionStorage (and resetting pending = committed on mount) preserves the App Studio author's last-published state across page reloads without polluting downstream cards with stale pending values.
- The Apply-to-commit pattern matches the native App Studio date controller's Between behaviour, so end users transferring from native controls don't have to relearn the gesture.
- The `window.__lastVariableUpdate` spy is gated by `IS_LOCAL` and ships in the bundle only as a single conditional assignment; production builds skip the assignment entirely because the `if (IS_LOCAL)` branch evaluates to `false`. No additional bundle weight in production.
- Future work (out of scope here): allow drag-selection across the calendar grid to define a range in one gesture; add a "Today / Last 7 days / Last 30 days" quick-pick row above the calendar grid in Between mode.
- Cross-link: this feature builds on the Between mode introduced in `specs/issue-pending-adw-pending-sdlc_planner-between-selection-mode.md`. Read that spec for context on the underlying data model and AppDB layout.
- After implementation, push to a follow-up branch (`variable-binding-ux`) off `between-selection` so the change can be reviewed independently rather than piling onto the Between PR.
