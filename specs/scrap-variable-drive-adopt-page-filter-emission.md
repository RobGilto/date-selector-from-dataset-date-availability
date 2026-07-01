# Plan: Scrap variable-drive contract; adopt page-filter emission (drop-down-app pattern)

## Metadata
- Task type: **refactor + feature** (major architectural pivot)
- Complexity: **complex**
- Trigger: 2026-07-01 customer feedback — Vijay explicitly rejected the
  variable-id path AND the variable-name path. Wants the brick to filter
  the whole page directly, mirroring Nine's `drop-down-app` (`ddx-filter-search`).

## Task Description

Rip out the App Studio variable emission contract entirely from the
Date Selector custom app. Replace with **page-filter emission** via
`domo.filterContainer([...])` — the same mechanism used by Nine's
production `drop-down-app` and `filter_defaults` bricks. Admin picks a
column from the bound dataset schema (not a variable id / name); on
date pick, the brick emits a page filter on that column. All cards on
the same App Studio page filtered by that dataset column refresh
automatically.

## Objective

Ship a v1.3 build where:

1. There is **no Variable name input** in the gear panel.
2. There is **no Variable ID input** in the gear panel.
3. There is **no `variablesDataSet` binding** in the manifest (removed).
4. Admin picks a **Filter column** (populated from the bound dataset schema)
   in the gear panel.
5. On date pick, brick emits `domo.filterContainer([{column, operator, values}])`.
6. Downstream cards on the page filter automatically without any
   variable wiring.
7. End users see only the dropdown (unchanged from v1.2).
8. Admin/owner-only gear (unchanged from v1.2).
9. Per-card AppDB config (unchanged from v1.2).

## Problem Statement

NAB stakeholders reviewed the v1.2 build (published 2026-06-24) and
concluded that both variable-id and variable-name inputs feel like
developer plumbing that end users and configuring admins should not
encounter. Quote: *"the customer does not like using the variable id
feature or the variable naming, so we will need to scrap that idea"*.

The variable-drive contract has three failures for NAB:

1. **Variable IDs are opaque** — admins must run a browser-console
   snippet or open a dev tool to discover them. Feels like a workaround.
2. **Variable names require a registry dataset** — customer must build
   and bind a two-column CSV mapping name → ID, then keep it in sync
   whenever App Studio renames or rebuilds a variable. That is real
   operational overhead for a single date-selector app.
3. **Wrong abstraction** — the target cards on NAB's Sample App page
   are filterable by page filter on the shared dataset's `Date` column.
   Emitting the filter directly is one hop; going via a variable
   requires the card's beast mode to reference the variable, which
   couples the brick to card-side plumbing that shouldn't exist.

Meanwhile, Nine has three production custom apps
(`drop-down-app`, `filter_defaults/v0.0.14_workspace`, `ddx-calendar`)
using `domo.filterContainer` as the primary emission channel. The
pattern is proven, documented, and NAB has said "yes, do it like that."

## Solution Approach

**Adopt the `domo.filterContainer` emission channel and drop the variable
API entirely.** Implementation lifts three specific patterns from Nine's
`drop-down-app/src/index.js`:

1. **Column discovery** — fetch the bound dataset schema on mount via a
   cheap `SELECT * ... LIMIT 1` sample; keys of the first row are the
   dataset's column names. Cache in localStorage with TTL.
2. **Column picker in gear panel** — admin picks one column from the
   discovered list; stored in the per-card AppDB config doc as
   `filterColumn` + `filterOperator` (default `EQ`; range mode uses
   `BETWEEN`).
3. **Emit via `domo.filterContainer`** — on date pick, build a filter
   payload `[{column, operator, values, dataType}]` and call
   `domo.filterContainer(payload)`. Guard against echo via a boolean
   flag (`isFiltersUpdatedFromAppToDashboard`) the same way
   drop-down-app does.

**Data-model implication (call out for NAB):**
NAB's existing beast modes reference `vTillSelectedMonth` and evaluate
cumulative-through logic (MTD / YTD). Page filter is not the same as
variable override — page filter narrows the rows the beast mode sees,
which BREAKS cumulative semantics. Two paths forward on NAB's side:

- **A (clean cut)** — NAB rebuilds cards to use dataset-level `Date`
  filter directly, so cumulative logic is derived from filtered rows
  via a running-total beast mode or an aggregation-side calculation.
- **B (dual emit, transition)** — keep an optional variable-emit path
  behind a hidden admin flag for one release cycle. Default OFF; NAB
  turns it ON per-card only where their cumulative beast modes still
  need it.

**Recommendation:** ship A (pure page-filter) since customer explicitly
scrapped the variable path. Flag the beast-mode implication in the
release notes and pair-review the first card with Vijay before the
Wednesday demo.

## Relevant Files

Use these files to complete the task:

- **`app/client/src/App.tsx`** — single React component. Where all UI, refs, effects, and handlers live.
- **`app/client/public/manifest.json`** — declare dataset alias, schema for the new AppDB fields, drop `variablesDataSet` alias.
- **`app/client/public/sample-data.csv`** — local mock; will be reused as the source of local schema fetch (its column set defines what the local column picker shows).
- **`app/client/src/lib/role.ts`** — unchanged; admin/owner gate still in effect.
- **`app/client/src/App.css`** — add tiny styles for the new column picker if needed. Existing `.settings-input` styles cover the base case.
- **`docs/SETUP.md`** — rewrite section 2 ("Configure which variable to drive") to become "Pick the filter column". Remove references to variable IDs.
- **`docs/DEVELOPMENT.md`** — update § 5.2 (App.tsx sections), § 7 (AppDB schema), and § 8 (variable inclusivity) to reflect the new contract.
- **`README.md`** — update the "How variable wiring works" section, replace with "How page filters flow".
- **`/Users/robertgilto/consulting/nine/drop-down-app/src/index.js`** — reference implementation. Study the emission call sites (line ~614: `domo.filterContainer(payload)`), the echo guard flag pattern (line ~96, ~653), and the schema-fetch pattern (line ~220: `SELECT * FROM alias LIMIT 1`).
- **`/Users/robertgilto/consulting/nine/drop-down-app/src/manifest.json`** — reference manifest; note the `packagesMapping` for `canConfigureApp` (may want to swap in for our existing `Domo AppStudio Pages` role check).

### New Files

- **`specs/scrap-variable-drive-adopt-page-filter-emission.md`** — this plan.
- **`.claude/commands/e2e/test_page_filter_emission.md`** — new E2E test command file that validates: admin picks column, date pick emits `filterContainer` payload, downstream cards refresh, second brick instance on same page holds independent column selection.
- **Optional**: `app/client/src/lib/schema.ts` — small helper wrapping `fetchDatasetColumns()` and its localStorage cache. Skip if it makes `App.tsx` cleaner inline.

## Implementation Phases

### Phase 1: Foundation

1. **Confirm `domo.filterContainer` exists in ryuu.js v6** — grep the
   installed ryuu module for the method signature and `onFiltersUpdate`
   listener. If the method is under a different name in v6 (e.g.
   `domo.postFilters`), adjust throughout.
2. **Confirm the schema-fetch endpoint** — read
   `/Users/robertgilto/consulting/nine/drop-down-app/src/index.js` line
   ~220 for the exact SQL-via-POST pattern (`domo.post('/sql/v1/<alias>',
   'SELECT * FROM ' + alias + ' LIMIT 1', { contentType: 'text/plain' })`).
   Verify the same pattern works with ryuu v6.
3. **Design the ConfigDoc migration path** — decide whether to delete
   or deprecate the pre-v1.3 fields (`variableName`, `functionId`,
   `rangeStartFunctionId`, `rangeEndFunctionId`). Recommendation: leave
   them in the TypeScript interface as `@deprecated` for one release,
   ignore on read, do not write on save.

### Phase 2: Core Implementation

1. **Manifest** — drop `variablesDataSet` from `datasetsMapping`. Drop
   `variableName`, `functionId`, `rangeStartFunctionId`,
   `rangeEndFunctionId` from the collection schema. Add `filterColumn`,
   `filterOperator`, `filterDataType` columns. Bump `version` → `1.3.0`.
2. **App.tsx — remove** —
   - `VARIABLES_DATASET_ALIAS` constant
   - `DEFAULT_SINGLE_FID` constant (was 131272)
   - `fetchLocalRegistry`, `resolveVarIds`, `varRegistryCache`,
     `varRegistryPromise` (registry path)
   - `registerVariablesListener`, `detectedVars`, `detectedVarsListeners`,
     `discoverViaPageControls` (auto-detect path)
   - `effectiveFid()` function
   - `variableNameRef`, `functionIdRef`, `rangeStartFidRef`,
     `rangeEndFidRef` (variable refs)
   - `variableName` state, `functionId` state, related setters
   - `inputFid`, `inputRangeStartFid`, `inputRangeEndFid` inputs
   - `saveSettingsFromForm` (redundant once numeric ID input is gone)
   - Every `domo.requestVariablesUpdate` call site
   - Every reference to `DetectedVar`, `detected` state
   - `sample-variables-registry.csv` (delete file)
3. **App.tsx — add** —
   - `fetchDatasetColumns()` helper. IS_LOCAL reads
     `public/sample-data.csv` header row. Else calls
     `domo.post('/sql/v1/sampleData', 'SELECT * FROM sampleData LIMIT 1',
     { contentType: 'text/plain' })` and reads keys of the first row.
     Cache in localStorage under `date-selector:columns:<datasetHash>` with
     30-minute TTL.
   - `filterColumn: string`, `filterOperator: 'EQ' | 'LTE' | 'GTE' | 'BETWEEN'`,
     `filterDataType?: 'string' | 'number' | 'date'` in `ConfigDoc`.
   - `filterColumnRef`, `filterOperatorRef` for callback use.
   - `[columns, setColumns] = useState<string[]>([])` populated on mount.
   - `emitFilter(payload)` helper wrapping
     `isFiltersEmittedFromApp = true; domo.filterContainer(payload)`.
     Guard flag flips back on next `onFiltersUpdate` echo.
   - `onFiltersUpdate` listener that IGNORES echos where the guard is
     set, and re-hydrates the picked date from external filter changes
     (round-trip pattern from drop-down-app).
4. **App.tsx — gear panel UI** —
   - Replace the current "Variable name" + "Variable ID (numeric)" +
     "Detected on this page" block with:
     - **Filter column** — `<select>` populated from `columns`
     - **Filter operator** — `<select>` with 4 options; default `EQ`
     - A live preview line showing the payload shape:
       `Filter → Date EQ 2026-05-15`
   - Keep the Default view radio and Date format select as-is.
   - Update the status line at the bottom:
     `Admin · Card <8-char-id> · filtering <column> <op>`
   - Update the no-wiring warning: shows when `!filterColumn`.
5. **App.tsx — handlers** —
   - `handleSingleSelect(date)`:
     ```ts
     const iso = toISO(date);
     if (!availableDates.has(iso)) return;
     setSingleSelected(date);
     persistState({ singleDate: iso });
     const col = filterColumnRef.current;
     const op = filterOperatorRef.current ?? 'EQ';
     if (!col) return;
     const payload = [{
       column: col,
       operator: op,
       values: [iso],
       dataType: filterDataTypeRef.current ?? 'date',
     }];
     if (IS_LOCAL) {
       console.log('[DEV] emit filterContainer:', payload);
       return;
     }
     isFiltersEmittedFromApp = true;
     (domo as any).filterContainer(payload);
     ```
   - `rehydrateVariables(state)` → renamed to `rehydrateFilter(state)`.
     Rebuilds the filter payload from the persisted state doc; called
     from `loadSettings` so cards re-filter on page reload without user
     re-clicking.
   - `applyRange` follows the same pattern with `BETWEEN` operator and
     two values.
6. **Local-dev parity** — `IS_LOCAL` branch of `emitFilter` logs to
   console instead of calling `filterContainer`. Local `fetchDatasetColumns`
   parses the CSV header row so the column picker isn't empty in dev.
7. **CSS** — no new styles required if the existing `.settings-input`
   covers the `<select>`. If the payload preview needs styling, add a
   `.settings-preview` class in `App.css`.

### Phase 3: Integration & Polish

1. **Docs rewrite** —
   - `docs/SETUP.md` § 2 becomes "Pick the filter column". No mention of
     variable IDs. Screenshot updated.
   - `docs/DEVELOPMENT.md` § 7 (AppDB schema) — swap the config fields.
     § 5.2 function inventory — drop `resolveVarIds`, `effectiveFid`,
     `registerVariablesListener`. Add `fetchDatasetColumns`, `emitFilter`.
   - `README.md` — replace "How variable wiring works" with "How page
     filters flow". Add a caveat block:
     > **Beast-mode implication:** page filters narrow the rows the beast
     > mode sees. Cumulative logic (MTD, YTD, running totals) MUST be
     > written to accept a filtered date set — a beast mode referencing
     > a page variable will NOT be driven by this brick.
2. **Regenerate screenshots** —
   - `docs/img/v1.3-01-admin-default.png` — gear + dropdown, no calendar
   - `docs/img/v1.3-02-settings-panel.png` — new column + operator UI
   - `docs/img/v1.3-03-end-user.png` — dropdown only
3. **Delete unused assets** — `public/sample-variables-registry.csv`
   goes; the `variablesDataSet` alias in the manifest goes.
4. **E2E command file** — new `.claude/commands/e2e/test_page_filter_emission.md`
   covering: (1) admin picks column, (2) picks a date, (3) inspect
   Network tab / Domo iframe protocol to confirm the filter payload,
   (4) verify downstream cards refresh, (5) confirm second brick on
   same page holds independent column config, (6) confirm reload
   rehydrates the filter from AppDB.
5. **Build + publish** — `npm run build` → zip → `npx ryuu publish`
   against the token already in ryuu's config. Bump zip name to
   `date-selector-1.3.0.zip`.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Branch and read
- `git checkout -b feat/v1.3-page-filter-emit` off `feat/v1.2-compact-rbac-per-card`.
- Read `app/client/src/App.tsx` end-to-end so the removal list is precise.
- Re-read `/Users/robertgilto/consulting/nine/drop-down-app/src/index.js` for the schema fetch (~line 220) and emission (~line 614) call sites.
- Confirm `domo.filterContainer` and `domo.onFiltersUpdate` exist on ryuu v6 — grep `node_modules/ryuu.js/dist/`.

### 2. Manifest surgery
- Drop `variablesDataSet` from `datasetsMapping`.
- Drop `variableName`, `functionId`, `rangeStartFunctionId`, `rangeEndFunctionId` columns from `collectionsMapping[0].schema.columns`.
- Add `filterColumn STRING`, `filterOperator STRING`, `filterDataType STRING` columns.
- Bump `version` to `1.3.0`.
- Consider swapping `packagesMapping[0]` to `canConfigureApp` (Nine drop-down-app pattern) — optional; keep current `Domo AppStudio Pages` if already provisioned on NAB.

### 3. Author the E2E command file
- Create `.claude/commands/e2e/test_page_filter_emission.md`.
- 6–8 numbered steps as outlined in Phase 3 § 4.

### 4. Rip the variable code path
- Delete constants: `VARIABLES_DATASET_ALIAS`, `DEFAULT_SINGLE_FID`.
- Delete helpers: `fetchLocalRegistry`, `resolveVarIds`, `varRegistryCache`, `varRegistryPromise`, `registerVariablesListener`, `discoverViaPageControls`, `notifyDetected`, `effectiveFid`.
- Delete refs: `variableNameRef`, `functionIdRef`, `rangeStartFidRef`, `rangeEndFidRef`.
- Delete state: `variableName`, `functionId`, `rangeStartFid`, `rangeEndFid`, `inputFid`, `inputRangeStartFid`, `inputRangeEndFid`, `autoDetected`, `detected`, `registry`.
- Delete setters + effects that touch the above.
- Delete every `domo.requestVariablesUpdate` call site.
- Delete `saveSettingsFromForm` (no numeric ID input to save).
- Delete `DetectedVar` interface and the `detectedVars` module-level Map.
- Delete `public/sample-variables-registry.csv`.

### 5. Add the schema-fetch helper
- Implement `fetchDatasetColumns(): Promise<string[]>`.
- IS_LOCAL branch: read `public/sample-data.csv`, split header row on `,`, return the array.
- Real branch: `domo.post('/sql/v1/' + DATASET_ALIAS, 'SELECT * FROM ' + DATASET_ALIAS + ' LIMIT 1', { contentType: 'text/plain' })`; extract row keys or use `.columns` array from the response shape depending on how ryuu returns SQL results.
- Cache in localStorage under a versioned key. TTL 30 min. Reject cache on version mismatch.

### 6. Wire column state
- Add `[columns, setColumns] = useState<string[]>([])`.
- On mount, call `fetchDatasetColumns().then(setColumns)`.
- Add `[filterColumn, setFilterColumn] = useState<string>('')`; ref counterpart `filterColumnRef`.
- Add `[filterOperator, setFilterOperator] = useState<FilterOperator>('EQ')`; ref counterpart.

### 7. Build the new emission path
- Add `emitFilter(payload)` that sets the echo-guard flag and calls `domo.filterContainer(payload)`.
- Register `domo.onFiltersUpdate` listener that: (a) ignores echos, (b) hydrates state from external filter changes so the brick's own dropdown reflects filters set elsewhere on the page.
- Update `handleSingleSelect` to call `emitFilter` when `filterColumn` is set.
- Update `applyRange` similarly with `BETWEEN` operator.
- `rehydrateVariables` → rename to `rehydrateFilter`. Rebuilds and emits the filter from persisted state on page load.

### 8. Redesign the gear panel
- Remove: "Detected on this page", "Variable name", "Variable ID (numeric)", no-wiring warning block.
- Add three new controls:
  - `Filter column` select (`{columns.map(...)}`)
  - `Filter operator` select (`EQ`, `LTE`, `GTE`, `BETWEEN`)
  - Preview line: `Filter → {filterColumn} {filterOperator} {samplePayload}`
- Keep Default view radio + Date format select unchanged.
- Update the status line at the bottom: `Admin · Card <8> · filter=<col> <op>`.
- Add a warning when `!filterColumn`: *"No filter column selected — date picks will not affect cards."*

### 9. Persist the new fields
- Update `persistSettings` to include `filterColumn`, `filterOperator`, `filterDataType`.
- Update `loadSettings` to hydrate the three new fields from the config doc; default `filterOperator` to `'EQ'` and `filterDataType` to `'date'`.
- Update `resetSettings` to null-out `filterColumn`/`filterOperator` on wipe.
- Update the ConfigDoc TypeScript interface to add the three fields and mark the four variable-era fields as `@deprecated /** @deprecated v1.3 */`.

### 10. IS_LOCAL parity
- Confirm the dev-role toggle still flips admin ↔ user correctly.
- Confirm the local column picker populates from `public/sample-data.csv` header.
- Confirm date picks in local mode log `[DEV] emit filterContainer: [...]` and do not attempt the real domo call.

### 11. Docs pass
- Rewrite `docs/SETUP.md` § 2 for the column picker flow.
- Rewrite `docs/DEVELOPMENT.md` §§ 5.2, 7, 8 for the new contract.
- Update `README.md` "How persistence / variable wiring works" sections.
- Add the beast-mode implication callout in README.

### 12. Screenshot pass
- Re-capture via Playwright at `docs/img/v1.3-*.png`.

### 13. Build + validate
- `cd app/client && npx tsc --noEmit` — must pass with zero errors.
- `cd app/client && npm run build` — must produce a clean bundle.
- `cd app/client && npm run dev` — smoke test both admin and user modes via the dev-role toggle. Column picker populated, filter emission logged.
- Execute the E2E command in `.claude/commands/e2e/test_page_filter_emission.md`.

### 14. Publish
- `cp public/manifest.json dist/manifest.json`.
- `cd dist && npx ryuu publish` against `nab-au.domo.com`.
- Rebuild the zip artefact `date-selector-1.3.0.zip` for the customer.
- Update the draft to Vijay with the release notes and the beast-mode-implication callout.

### 15. Merge + push
- `git commit -am "feat(v1.3): scrap variable drive; adopt domo.filterContainer page filter emission"`.
- `git checkout main && git merge --ff-only feat/v1.3-page-filter-emit`.
- `git push origin main`.

## Testing Strategy

**Unit tests:** codebase carries no unit test harness. Not adding one for
this release. Everything is exercised via the E2E command + manual dev
server verification.

**Edge cases (must exercise via E2E or dev server):**

1. `filterColumn` empty on first install. Brick shows warning; date pick is a no-op. AppDB config doc created only after admin saves a column.
2. Bound dataset schema fetch fails (network or permission). Column picker falls back to a single free-text input so admin can type the column name manually. Log the failure to console for diagnosis.
3. Column name contains characters that break the SQL literal — dataset column names are already SQL-safe in Domo so this is unlikely, but the emitter should still URL-encode the column string to be defensive.
4. Two brick instances on same page with different `filterColumn`. Each emits its own filter. If both target the same column, last write wins — acceptable.
5. External filter set on the page (from another card / native filter). `onFiltersUpdate` listener hydrates the brick's picked-date state to reflect it.
6. Legacy pre-v1.3 config doc exists (has `variableName` / `functionId`). Ignored on read. Warning logged: *"Legacy config detected — pick a Filter column to migrate."* Next save writes a v1.3-shaped doc; the legacy doc remains untouched but unread.
7. `BETWEEN` operator with the same start and end date. Emits `values: [d, d]`. Downstream cards filter to just that day.
8. Range mode (still gated by `HIDE_BETWEEN`) — verify the between-mode code paths compile even if not visible in UI.
9. Beast mode on downstream card references the (now-unset) `vTillSelectedMonth` variable. Card either falls back to its default value or errors — depends on the beast mode. NAB owns fixing this per the release-note callout.

## Acceptance Criteria

1. Gear panel shows no Variable name input, no Variable ID input, no Detected list, no discovery snippet. Only Filter column + Filter operator + Default view + Date format.
2. `variablesDataSet` alias is absent from `manifest.json`.
3. `public/sample-variables-registry.csv` is absent from the repo.
4. On date pick with a configured filter column, browser Network tab / iframe protocol shows the `filterContainer` message. Console (dev mode) logs `[DEV] emit filterContainer: [...]`.
5. Downstream cards on the same page that filter by the selected column refresh after each pick.
6. Two brick instances on the same page can hold different `filterColumn` values simultaneously — verified via AppDB doc inspection.
7. `manifest.json` version is `1.3.0`. Collection schema declares `filterColumn`, `filterOperator`, `filterDataType`. Variable-era columns are removed.
8. `npx tsc --noEmit` passes with zero errors.
9. `npm run build` produces a clean bundle (< 300 KB gzipped).
10. `date-selector-1.3.0.zip` uploaded to `nab-au.domo.com` and the design id `4896fd53-...` is updated in place.
11. `docs/SETUP.md`, `docs/DEVELOPMENT.md`, `README.md` reflect the new contract. Beast-mode implication callout present in README.
12. The E2E command `.claude/commands/e2e/test_page_filter_emission.md` runs to completion without failures.

## Validation Commands

Execute these commands to validate the task is complete:

- `cd app/client && rm -rf node_modules/.vite && npm install` — ensure fresh install picks up the manifest changes.
- `cd app/client && npx tsc --noEmit` — TypeScript compilation, must have zero errors.
- `cd app/client && npm run build` — production build, must succeed.
- `grep -c "requestVariablesUpdate\|variableName\|VARIABLES_DATASET_ALIAS\|DISCOVERY_SNIPPET\|resolveVarIds\|registerVariablesListener" app/client/src/App.tsx` — must print `0`. Confirms the variable code path is fully removed.
- `grep -c "filterContainer" app/client/src/App.tsx` — must print `>= 1`.
- `unzip -p app/client/date-selector-1.3.0.zip manifest.json | jq -r '.version'` — must print `1.3.0`.
- `unzip -p app/client/date-selector-1.3.0.zip manifest.json | jq -r '.datasetsMapping | length'` — must print `1` (only `sampleData`; no `variablesDataSet`).
- `unzip -p app/client/date-selector-1.3.0.zip manifest.json | jq -r '.collectionsMapping[0].schema.columns[] | .name' | sort` — must include `filterColumn`, `filterOperator`, `filterDataType`.
- Read `.claude/commands/e2e/test_page_filter_emission.md` and execute per its steps.
- Manual verification: publish to `nab-au.domo.com`, refresh the test card at `https://nab-au.domo.com/app-studio/1292970502/pages/1611752341`, confirm as an admin that the Filter column dropdown lists the dataset columns, pick a date, watch the downstream card update.

## Notes

- **No new dependencies.** Everything builds on the existing React 18 + Vite 5 + ryuu.js v6 + date-fns v3 stack.
- **`domo.filterContainer` API verification** — reference implementation at `/Users/robertgilto/consulting/nine/drop-down-app/src/index.js` line ~614 confirms the method name and payload shape. Confirm the ryuu v6 module exports the same before ripping the variable path — five-minute check.
- **Beast-mode impact for NAB** — the biggest customer-side risk. Their `MTD_KPI_SampleApp` and `YTD_KPI_SampleApp` beast modes reference `vTillSelectedMonth` today. After v1.3 the variable stops being driven; cards either freeze on last known variable value or fall back to their default. NAB must rebuild the beast modes to filter on the raw `Date` column, or accept an interim period where the KPI cards show all-time totals. Include this in the release note to Vijay explicitly.
- **`packagesMapping` for `canConfigureApp`** — Nine's drop-down-app uses `App Config Access.canConfigureApp` (packageId `d191b1b8-0210-4530-b18d-89952c5ea3f4`). Slightly different from our current `Domo AppStudio Pages.checkUserAppStudioRole`. Both work as a boolean admin gate. Keep whichever is already provisioned on `nab-au.domo.com`; changing packages mid-release is churn we don't need.
- **`filterContainer` echo guard** — critical detail from drop-down-app. Without the boolean flag, the `onFiltersUpdate` listener catches our own emission and loops. Copy the pattern (`isFiltersUpdatedFromAppToDashboard`) verbatim.
- **Range mode revisit** — v1.2 kept the "Between" tab hidden via `HIDE_BETWEEN`. This plan preserves the flag. `BETWEEN` operator is trivially wired for a future release toggle.
- **Rollback plan** — if NAB's beast modes can't be rewritten by Wednesday's demo, the immediate rollback is to republish `date-selector-1.2.0.zip` (still on disk at the time of publish) which restores the variable-drive contract. No AppDB migration needed to roll back because v1.3 doc shape is additive over v1.2.
- **Follow-up (out of scope for v1.3, worth noting)** — multi-column filter emission. Once the single-column path is stable, adding a second column picker to filter by, say, both Date and Region would be straightforward. Multi-filter is drop-down-app's primary feature; we're using a tiny subset of its capability.
