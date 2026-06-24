# Feature: Compact end-user UI + RBAC gear + per-card settings + name-based variable resolution

## Metadata
issue_number: `002`
adw_id: `feat-v2-release`
issue_json: `{"title": "v1.2 release: compact footprint, admin-only gear, per-card settings, name-based variable resolution", "body": "Smaller footprint. Drop the calendar / list / gear buttons from the end-user view, leaving the dropdown as the main interaction. Admin-only and page owner gear. Per-card settings so different cards can use different date formats. 'In Between' tab hidden. Toolbar label removed. Reference nine v0.0.14_workspace for elegant variable selection."}`

## Feature Description

This is the v1.2 release of the Date Selector custom app, agreed with NAB stakeholder Digvijay Moray on the 2026-06-18 call. The release covers four user-visible changes plus one architectural rebuild of the variable-resolution pipeline:

1. **Compact footprint for end users** — the toolbar with List / Calendar / gear icons disappears for non-admins. End users see only the dropdown of available dates plus, optionally, the calendar grid.

2. **Admin / page-owner-only gear icon** — the settings (⚙) icon is only visible to users who hold an `Admin` system role OR who are listed as the App Studio app's owner (resolved via the `Domo AppStudio Pages` Code Engine package, `checkUserAppStudioRole` function). Everyone else sees a clean dropdown.

3. **Per-card settings** — each card-instance of the brick keeps its own configuration (variable wiring, date format, view mode). Two cards on the same dashboard can drive different variables or render different label formats without overwriting each other. The AppDB collection becomes `(cardId, docType)`-keyed instead of design-wide.

4. **In Between tab hidden** — already gated by `HIDE_BETWEEN = true`. Keep the constant; tighten the surrounding code so it's truly invisible (CSS toggle removed, no flicker on first paint). Confirm no Between-related controls leak.

5. **Toolbar label removed** — the "Active: single=131272…" / `selected-display` toolbar text is redundant once the dropdown reflects the picked date. Remove it from the user view; admins keep a small confirmation under the gear panel.

The most important rebuild is the variable-resolution pipeline. The current "paste a snippet into the browser console" UX got flagged on the call as hacky and unfit for production. We adopt the Nine `filter_defaults/v0.0.14_workspace` pattern: a small reference dataset (`variablesDataSet` — already declared in our manifest) maps a human-readable `Variable` name to its numeric `VariableID`. Admins type the name; the brick resolves at runtime. The console-snippet path is removed entirely.

## User Story

**Story 1 — End user:**
- As an end user viewing a dashboard with the Date Selector card
- I want to see only the date dropdown and pick a date
- So that I am not distracted by configuration UI that does not belong to me

**Story 2 — Admin / App owner:**
- As a Domo Admin or the owner of the App Studio dashboard hosting this card
- I want to configure the variable, date format, and visible view per card
- So that two cards on the same page can drive different variables and render different formats independently

**Story 3 — Admin (variable wiring):**
- As an admin configuring a Date Selector card
- I want to pick the App Studio variable to drive by name from an autocomplete dropdown
- So that I never have to open browser dev tools or copy paste opaque numeric IDs

## Problem Statement

The v1.1 release ships a working brick but the configuration UX has three production-blocking issues:

1. **End users see admin controls.** Anyone with view access to the page can see the List / Calendar / gear icons. The gear opens a settings panel that, while it doesn't expose data, looks like a developer panel and reads as "this product is not finished" to the business. NAB flagged this directly: "it doesn't feel like production ready. It's just like a prototype."

2. **Variable wiring requires browser dev tools.** Today, an admin who wants to bind the brick to a variable must open the browser console, paste a Domo-internal endpoint snippet, read the result table, and paste the numeric `functionId` into the gear field. The snippet also failed to return data on at least one NAB page during the 2026-06-18 call. NAB asked for "a more elegant solution" before they release this to stakeholders.

3. **Settings are design-global, not card-scoped.** The AppDB collection holds one config doc and one state doc for the entire design. Two cards on the same page can't independently configure date formats or drive different variables. They will read each other's docs and clobber each other on every pick. The README currently frames this as "by design" but Vijay's call specifically asked for per-card configuration so different cards can use different formats.

## Solution Statement

The solution combines a permissions check, a card-scoped storage refactor, and a swap of the variable-resolution backend:

1. **Visibility gate.** On mount, the brick determines the current viewer's role. If `isAdmin || isAppOwner`, render the existing toolbar + gear. Otherwise, render the dropdown alone (or the calendar alone, if the saved view mode is `calendar`). The admin-only gear pattern lives in the manifest's `packagesMapping` for a Code Engine package called `Domo AppStudio Pages` exposing a `checkUserAppStudioRole(appId)` function that returns true when the current user owns the App Studio app. The system-admin check uses `domo.env.userRole` (or, when missing, the existing detected-vars handshake as a fallback heuristic).

2. **Card-scoped AppDB documents.** Use `domo.env.cardId` (Domo populates this on every brick instance) as part of every doc's `content` payload. Replace the current "first doc wins" `loadSettings` logic with a query that filters by `content.cardId === currentCardId`. New `ConfigDoc` and `StateDoc` shapes gain `cardId: string`. Legacy unkeyed docs are treated as the design-wide default (read-only safety net during migration; new writes always carry a `cardId`).

3. **Name-based variable resolution.** The `variablesDataSet` manifest binding already exists but is optional. Make it the primary configuration path: settings panel renames "Single date variable ID" → "Variable name", autocomplete suggestions come from `domo.get('/data/v1/variablesDataSet?fields=Variable,VariableID')`. At push time, `effectiveFid()` resolves the saved name → ID by querying the cached registry. The legacy numeric ID input becomes a hidden fallback only used when the dataset is empty or unbound. The browser-console snippet UI is removed entirely.

4. **End-user surface.** Hide the List / Calendar / gear toggle group when `mode === 'user'`. Remove the redundant `selected-display` toolbar label. Calendar/list view mode becomes a per-card saved preference (admin picks once, end users see only that). Default view = list (per call: "or a dropdown over here to say, okay").

5. **In Between** stays gated by `HIDE_BETWEEN = true`. No new visible Between controls.

## Relevant Files

Use these files to implement the feature:

- `README.md` — read first; contains the v1.1 contract and the AppDB persistence model. The "Configure once, reuse across pages" note will need updating.
- `app/client/src/App.tsx` — the single React component that owns everything. All UI changes, the role check, the registry rewrite, and the per-card storage refactor land here.
- `app/client/src/App.css` — toolbar / mode-toggle / settings-panel styles. Gate the toolbar visibility via a new `mode-admin` / `mode-user` body class.
- `app/client/public/manifest.json` — needs a new `packagesMapping` entry for the `Domo AppStudio Pages` package (`checkUserAppStudioRole` function) and a manifest schema bump on the `nab-date-selector-settings` collection so docs can carry `cardId`.
- `app/client/public/sample-variables-registry.csv` — local-mode mock for the registry path. Add at least three rows so the autocomplete is exercised in dev.
- `app/client/public/sample-data.csv` — unchanged.
- `docs/SETUP.md` — the admin install / per-page configuration guide. Rewrites needed for the name-based registry workflow, the admin-only gear behaviour, and the per-card settings story.
- `docs/DEVELOPMENT.md` — the developer doc. Update the AppDB schema section (cardId column added), the "two doc types" section, and the `effectiveFid()` chain explanation.
- `docs/img/` — re-capture `02-settings-panel.png` and `03-calendar-selected.png` once the new UI lands. Add a new `05-end-user-view.png` showing the minimal dropdown-only surface.
- `/Users/robertgilto/consulting/nine/filter_defaults/v0.0.14_workspace/manifest.json` — reference manifest showing the `packagesMapping` block for `isUserAppOwner` (Code Engine), `collectionsMapping` shape with `syncEnabled`, and the canonical `variablesDataSet` binding. Mirror its structure.
- `/Users/robertgilto/consulting/nine/filter_defaults/v0.0.14_workspace/config.js` — reference for `USERMODE` / `ADMINMODE` state machine, `appState.owner`, `APPID` / `PAGEID` env unpacking.
- `/Users/robertgilto/consulting/nine/filter_defaults/v0.0.14_workspace/helpers.js` — reference for `toggleAdminControls()`, `setDomoVariables(start, end)` shape, `getCollectionDocumentID()`, and the graceful Code Engine 404 fallback (`owner=true` when the package errors).
- `/Users/robertgilto/consulting/nine/filter_defaults/v0.0.14_workspace/app.css` — reference for the `.admin` / `.viewer` / `.hidden` CSS pattern. Don't copy verbatim; adapt to our existing class names.
- `.claude/commands/test_e2e.md` — read before authoring the new E2E command file. Establishes the conventions our E2E test must follow.
- `.claude/commands/start.md` — `npm run dev` from `app/client/`, port 5173.
- `.claude/commands/ship.md` — `npx ryuu publish` from `app/client/dist/` against the configured Domo instance.

### New Files

- `specs/issue-002-adw-feat-v2-release-sdlc_planner-compact-rbac-per-card-elegant-variable.md` — this plan.
- `.claude/commands/e2e/test_compact_rbac_per_card.md` — new E2E test command file that validates: end-user sees only the dropdown; admin sees gear; configuring card A does not affect card B; picking a name from the autocomplete pushes the resolved functionId via `requestVariablesUpdate`.
- `docs/img/05-end-user-view.png` — new screenshot of the dropdown-only end-user surface (captured during E2E).
- `app/client/src/lib/role.ts` *(optional helper module)* — small wrapper around the `checkUserAppStudioRole` Code Engine call plus the system-admin shortcut. Keeps `App.tsx` free of role-related branching noise. Skip if it makes `App.tsx` cleaner to leave inline.

## Implementation Plan

### Phase 1: Foundation

1. **Update `manifest.json`:**
   - Add `packagesMapping[0]` referencing the `Domo AppStudio Pages` Code Engine package: function name `checkUserAppStudioRole`, parameter `appId`, output `result: boolean`. Mirror the Nine `v0.0.14_workspace` manifest verbatim except for the `id`, `name`, and (if instance-specific) `packageId` fields.
   - Add a `cardId` STRING column to the `date-selector-settings` collection schema. Add a `viewMode` STRING column and a `dateFormat` STRING column to support per-card view + format selection.
   - Bump `version` → `1.2.0`.

2. **Add `app/client/src/lib/role.ts`** (or inline equivalent) exposing:
   - `async function checkIsAppOwner(): Promise<boolean>` — calls `domo.post('/domo/codeengine/...', {appId: domo.env.dataAppId})` against the package alias. Catches the Code Engine 404 and returns `true` (matches Nine's defensive fallback so config never gets locked out).
   - `function isAdmin(): boolean` — returns true when `domo.env.userRole === 'Admin'` OR `domo.env.userRole === 'Privileged'`.
   - `async function resolveRole(): Promise<'admin' | 'user'>` — combines the two checks; admin wins.

3. **Read the Nine helpers** (`getCollectionDocumentID`, `appState.mode`, `toggleAdminControls`) for the load/save sequence shape. Don't duplicate logic; transpose patterns to our React/TS idiom.

### Phase 2: Core Implementation

1. **Card-scoped AppDB.** Refactor the existing `collBackend` helpers in `App.tsx`:
   - Every `ConfigDoc` and `StateDoc` written carries `cardId: domo.env.cardId` (fall back to `'default'` when undefined for local-dev compatibility).
   - `loadSettings` queries the collection and filters in-memory by `content.cardId === currentCardId`. If no card-keyed doc exists, fall back to a single legacy doc with no `cardId` (read-only safety net during migration).
   - Add `currentCardId` to module scope, computed once on mount.

2. **Variable name resolution becomes primary.**
   - Remove the "Discover variable IDs" console-snippet UI block entirely (settings panel block + the `DISCOVERY_SNIPPET` constant).
   - Rename the gear field "Single date variable ID (legacy fallback)" → "Variable name". Bind to `variableName` in `ConfigDoc`. Show an autocomplete `<datalist>` populated from `resolveVarIds()` (already implemented).
   - `effectiveFid()` chain becomes: `(1) resolve via registry by name → (2) fall back to legacy numeric `functionId` for already-deployed cards`. Keep the numeric fallback but stop exposing it in the UI.
   - When the registry is empty (dataset unbound or has zero rows), show an inline hint: "Bind the variables registry dataset to enable variable selection (see SETUP.md)."

3. **Role-gated UI.**
   - On mount: `const role = await resolveRole()`. Store in component state.
   - When `role === 'user'`:
     - Hide the entire toolbar (List / Calendar / gear icon row).
     - Hide the `selected-display` label.
     - Render only the saved-view mode (default `list`). If the admin saved `calendar`, render the calendar; otherwise render the dropdown.
     - The "in between" mode toggle stays gated by the existing `HIDE_BETWEEN` constant — no additional work needed.
   - When `role === 'admin'`:
     - Render existing toolbar including the gear icon.
     - Gear panel gets a new "Default view" radio: `Calendar` / `List`. Saves to `ConfigDoc.viewMode`.
     - Show a small admin-only badge or text under the gear panel: `Admin · Card <cardId.slice(0,8)>` so it's clear which card you're configuring.

4. **Per-card date format.**
   - Add `dateFormat: 'YYYY-MMM' | 'YYYY-MMM-DD' | 'YYYY-MM-DD'` to `ConfigDoc` (default `'YYYY-MMM-DD'`).
   - `formatDateLabel` consults the per-card format setting.
   - Admin gear panel adds a "Date format" select with the three options + a live preview of today's date in that format.

5. **Remove the toolbar label** (the `selected-display` span). Replace with a tiny `aria-live` region for screen readers only.

### Phase 3: Integration

1. **Local development parity.**
   - `IS_LOCAL` branch of the role check returns `'admin'` so the dev experience is unchanged.
   - `IS_LOCAL` branch of `domo.env.cardId` falls back to `'local-card-001'`.
   - Add an admin/user mode toggle in dev only (small button bottom-right) so the developer can preview both surfaces without publishing.

2. **Migration path for already-deployed cards.**
   - On first load against the v1.2 brick, the legacy single design-wide doc is still readable. The brick treats it as a default but immediately writes a new card-keyed doc the next time the admin saves a change.
   - Document the migration in `DEVELOPMENT.md` Section 7 (AppDB collection schema).

3. **Documentation refresh.**
   - `docs/SETUP.md` — replace the "Find each variable's function ID" steps with "Pick the variable name from the dropdown" steps. Add a "Visible to admins only" callout in section 2.
   - `docs/DEVELOPMENT.md` — update the AppDB schema table to show the new columns (`cardId`, `viewMode`, `dateFormat`). Update the `effectiveFid()` description to drop the page-controls 404 fallback and elevate the registry path to primary.
   - `README.md` — the "Configure once, reuse across pages" callout becomes "Configure per card — each card on a page holds its own settings."

4. **Re-capture screenshots** at the new compact end-user size (around 320x180 — closer to actual Domo card real estate). Replace `02-settings-panel.png`, `03-calendar-selected.png`. Add `05-end-user-view.png`.

5. **Bump zip artefact** to `date-selector-1.2.0.zip` for the customer upload step.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Branch and read
- Create a new feature branch off `main`: `git checkout -b feat/v1.2-compact-rbac-per-card`.
- Read `README.md`, `app/client/src/App.tsx`, `app/client/public/manifest.json`, `docs/SETUP.md`, `docs/DEVELOPMENT.md`.
- Read the three reference files in `/Users/robertgilto/consulting/nine/filter_defaults/v0.0.14_workspace/`: `manifest.json`, `config.js`, `helpers.js`.
- Read `.claude/commands/test_e2e.md` (then keep the file open) so the E2E command authored in task 11 matches conventions.

### Task 2 — Write the E2E test command file
- Create `.claude/commands/e2e/test_compact_rbac_per_card.md` with steps:
  1. Open the published card as a non-Admin / non-owner user. Screenshot. Assert no toolbar visible, no gear icon, dropdown present.
  2. Open the same card as an Admin. Screenshot. Assert gear icon present.
  3. As Admin, open the gear, choose a different variable name from the autocomplete, change date format, save. Screenshot the gear panel.
  4. Drop a second instance of the brick on the same page. Configure it with a different variable / format. Screenshot.
  5. Reload the page. Each card retains its own configuration. Screenshot both cards.
- Keep the minimum step set; aim for 5–7 numbered steps.

### Task 3 — Manifest updates
- Edit `app/client/public/manifest.json`:
  - Add `packagesMapping[0]` for `Domo AppStudio Pages` / `checkUserAppStudioRole`. Set `packageId` to an empty string for now and add a comment in the SETUP doc that NAB designer must rebind on install.
  - Extend `collectionsMapping[0].schema.columns` with `cardId STRING`, `viewMode STRING`, `dateFormat STRING`.
  - Bump `version` to `1.2.0`.

### Task 4 — Add role resolution
- Create `app/client/src/lib/role.ts` exposing `resolveRole()`, `checkIsAppOwner()`, `isAdmin()`. Wrap the Code Engine call in a try/catch that returns `true` on any error (matches Nine's fallback rationale).
- In `App.tsx`, import `resolveRole` and resolve on mount. Store result in component state `role`.

### Task 5 — Refactor AppDB writes to carry `cardId`
- In `App.tsx`, capture `const CURRENT_CARD_ID = (domo as any).env?.cardId ?? 'local-card-001';` once at module scope (after the `IS_LOCAL` check).
- Update `persistSettings`, `persistState`, `loadSettings` to:
  - Tag every new doc payload with `cardId: CURRENT_CARD_ID`.
  - Filter `loadSettings` query results in JS: prefer the doc with `content.cardId === CURRENT_CARD_ID`, fall back to the legacy doc (no `cardId` field) if no card-keyed doc exists.

### Task 6 — Replace variable-ID input with variable-name autocomplete
- Remove the `DISCOVERY_SNIPPET` constant and the copy-snippet block from the settings panel JSX.
- Remove `setShowDiscoverySnippet` and related state if any.
- Add `<datalist id="vars-list">` populated from `resolveVarIds()`'s returned map.
- Add a labelled `<input list="vars-list">` bound to `variableName` in component state. Persist on change via `persistSettings({ variableName })`.
- Add an inline "Bind the variables registry dataset…" hint when the registry returns zero rows.

### Task 7 — Update `effectiveFid()`
- Drop the page-controls 404 path entirely (we never relied on it post-1.1; remove the dead branch).
- Resolve order: `(1) variableName via registry map → (2) functionId from legacy ConfigDoc → (3) null`.

### Task 8 — Role-gated rendering in App.tsx
- Wrap the toolbar `<div>` (List / Calendar / gear icons) in `{role === 'admin' && (...)}`.
- Wrap the `selected-display` label removal: delete the span; no replacement (admins see selection via the dropdown itself).
- Add `mode-admin` / `mode-user` className on the root `<div>` so CSS can hide other admin-only DOM if needed later.

### Task 9 — Per-card view mode + date format
- Add `viewMode: 'calendar' | 'list'` and `dateFormat: 'YYYY-MMM' | 'YYYY-MMM-DD' | 'YYYY-MM-DD'` to `ConfigDoc`.
- Default `viewMode` → `'list'` (per Vijay's call).
- In the gear panel, add a "Default view" radio group and a "Date format" `<select>` with a live preview line: `Preview: {formatDateLabel(today, dateFormat)}`.
- `formatDateLabel` reads `dateFormat` from component state.

### Task 10 — IS_LOCAL parity
- In `lib/role.ts`, short-circuit `resolveRole()` to return `'admin'` when `IS_LOCAL`.
- Add a small dev-only "Switch to user view" button in `App.tsx`, rendered only when `IS_LOCAL`, that toggles the `role` state for visual preview.

### Task 11 — Validation
- Run `cd app/client && npm install` (in case any new lib was added; none expected for this feature).
- Run `cd app/client && npx tsc --noEmit` to confirm no type errors.
- Run `cd app/client && npm run build` to confirm a clean bundle.
- Start dev server `cd app/client && npm run dev`. Open `http://localhost:5173`. Verify:
  - End-user simulation (dev-only toggle) shows only the dropdown.
  - Admin view shows the toolbar + gear.
  - Configuring two card instances via two separate dev sessions writes two card-keyed docs to localStorage.
- Execute the E2E test file: read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_compact_rbac_per_card.md` per the conventions described in `test_e2e.md`.

### Task 12 — Documentation refresh
- Update `docs/SETUP.md` per the "Documentation refresh" notes in Phase 3.
- Update `docs/DEVELOPMENT.md` per the same notes.
- Update `README.md` "Configure once, reuse across pages" line.
- Re-capture screenshots (`02-settings-panel.png`, `03-calendar-selected.png`, new `05-end-user-view.png`). Use Playwright if available, otherwise capture manually and store under `docs/img/`.

### Task 13 — Build, zip, publish
- `npm run build`.
- Zip: `cd dist && zip -r ../date-selector-1.2.0.zip .`.
- Commit: `git add -A && git commit -m "feat(v1.2): compact end-user UI, admin-only gear, per-card settings, name-based vars"`.
- Push to branch: `git push origin feat/v1.2-compact-rbac-per-card`.
- Open a PR against `main` summarising the four user-visible changes and the variable-resolution rebuild.

### Task 14 — Run validation commands (final)
- Execute every command in the **Validation Commands** section below, top to bottom. Capture output. Resolve every failure before marking the feature complete.

## Testing Strategy

### Unit Tests

This codebase doesn't currently ship unit tests (single-file React component, all behaviour exercised via the dev server + Playwright). Adding a unit-test harness is out of scope for this release. Where logic moved to `lib/role.ts`, keep the functions small and pure so a later unit-test pass can cover them in one sitting.

### Edge Cases

Test all of the following manually via the dev server (or as steps in the E2E command):

1. `domo.env.cardId` is undefined (older Domo instances or unusual contexts). Brick falls back to `'local-card-001'` and still functions.
2. Registry dataset is unbound. Settings panel shows the "Bind the registry dataset" hint; legacy `functionId` field still works.
3. Registry dataset is bound but empty. Same behaviour as unbound — autocomplete is empty, hint shown.
4. Registry contains the configured variable name. Picking it resolves and pushes the correct `functionId`.
5. Registry does NOT contain the configured variable name (typo or stale config). `effectiveFid()` returns null; brick logs a warning and the pick is a no-op against the variable (state still persists).
6. Code Engine `checkUserAppStudioRole` returns 404 (package not provisioned on the instance). Brick falls back to `role = 'admin'` per Nine's pattern so config never gets locked.
7. Code Engine returns `false` AND `domo.env.userRole !== 'Admin'`. Brick renders the user view (no gear).
8. Two cards on one page. Each card writes its own doc keyed by `cardId`. Configuring one doesn't affect the other.
9. Legacy doc exists (pre-v1.2) without `cardId`. Brick reads it as the default for a card-instance that has no card-keyed doc yet; the next save creates a new card-keyed doc and the legacy doc remains untouched.
10. Date format change. `viewMode='list'` dropdown labels update; calendar header updates; toolbar selection (admin-only path) updates.

## Acceptance Criteria

1. An end user (non-Admin, non-owner) opening the page sees the dropdown only. No toolbar, no gear icon, no calendar/list toggle, no `selected-display` label.
2. An Admin opening the page sees the toolbar (List + Calendar + gear) as in v1.1.
3. The owner of the App Studio app sees the same view as an Admin, even when their system role is `Participant`.
4. Two card-instances of the brick on the same page can be configured independently. Saving config on card A does not change config on card B.
5. The gear panel shows a "Variable name" `<input list>` autocomplete sourced from `variablesDataSet`. The legacy numeric `functionId` input no longer appears.
6. The "Discover variable IDs" console snippet block is gone from the gear panel.
7. Picking a variable name → saving → picking a date in the calendar/list → the cards on the page filtered by that variable refresh. Confirmed via either a HAR capture or by visual inspection on `https://nab-au.domo.com/app-studio/1292970502/pages/1611752341`.
8. The "In Between" mode toggle is invisible. There is no flicker on first paint where it briefly appears.
9. `manifest.json` declares `version: "1.2.0"`, the `Domo AppStudio Pages` package mapping, and three new collection columns (`cardId`, `viewMode`, `dateFormat`).
10. `tsc --noEmit` passes. `npm run build` produces a clean bundle. The `date-selector-1.2.0.zip` artefact exists.
11. `docs/SETUP.md`, `docs/DEVELOPMENT.md`, `README.md` reflect the new behaviour. Screenshots `02-settings-panel.png`, `03-calendar-selected.png`, and a new `05-end-user-view.png` are captured at the new compact size.
12. The E2E test command file `.claude/commands/e2e/test_compact_rbac_per_card.md` runs to completion without failures.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `cd app/client && npm install` — ensure dependencies are installed.
- `cd app/client && npx tsc --noEmit` — type-check, must pass with zero errors.
- `cd app/client && npm run build` — production build, must succeed.
- `cd app/client && npm run dev &` then visit `http://localhost:5173` — manually verify the admin view and toggle to user view via the dev-only switcher. Verify the registry autocomplete populates from `public/sample-variables-registry.csv`. Pick a date and confirm `[DEV] single pick: <iso> (fid= <resolved>)` appears in the browser console with the resolved ID matching the picked name. Stop the server (`kill %1`) when done.
- Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_compact_rbac_per_card.md` per its conventions. Every numbered step must pass.
- `unzip -p app/client/date-selector-1.2.0.zip manifest.json | jq -r '.version'` — must print `1.2.0`.
- `unzip -p app/client/date-selector-1.2.0.zip manifest.json | jq -r '.collectionsMapping[0].schema.columns[] | .name'` — must include `cardId`, `viewMode`, `dateFormat`.
- `unzip -p app/client/date-selector-1.2.0.zip manifest.json | jq -r '.packagesMapping[0].functionName'` — must print `checkUserAppStudioRole`.
- `grep -c "DISCOVERY_SNIPPET" app/client/src/App.tsx` — must print `0` (the snippet UI is gone).

## Notes

- **Code Engine package availability.** The `Domo AppStudio Pages` package with `checkUserAppStudioRole` exists on the Nine instance (`bb60feb4-b9fa-4eee-89bf-263890c8f96e`). NAB instance may need the same package installed or repointed to a NAB-side equivalent. If the package errors out at install, the role check defaults to `admin: true` per the safety net — so the v1.2 brick still functions, just without the visibility split. Document this caveat in `SETUP.md`.
- **`variablesDataSet` binding.** Customers must bind this dataset at install time. The starter `public/sample-variables-registry.csv` ships as a template. We could also generate the CSV from a one-off script that scrapes a Domo page via `/api/content/v1/cards/variable/controls?functionTemplateIds=...` (the same endpoint visible in NAB's HAR captures). Out of scope for this release but worth queuing for v1.3.
- **No new dependencies.** Everything builds on the existing React/Vite/ryuu/date-fns stack. No `uv add` or `npm install <new-lib>` required.
- **Backwards compatibility.** The legacy unkeyed config doc remains readable. Cards deployed pre-v1.2 keep working as a degenerate `cardId === undefined` case. The first save under v1.2 writes a new card-keyed doc; the legacy doc is left in place (no auto-delete) so a roll-back to v1.1 stays clean.
- **Migration script (optional, v1.3).** A small admin tool that walks every doc in the collection and back-fills `cardId` based on which page the doc was originally created from would clean up the AppDB long term. Not blocking for this release.
- **Owner-vs-Admin precedence.** When both checks return true, the user is treated as admin (gear visible). When only `isAppOwner` returns true but the system role is `Participant`, gear is still visible (this is the explicit ask from the call: "Admin or page owner").
- **In Between**: the constant `HIDE_BETWEEN = true` in `App.tsx` stays. The mode-toggle UI is wrapped in `{!HIDE_BETWEEN && ...}` already; verify the conditional includes the range-related controls in the calendar component too (some between-mode-only state may still leak rendering work — measure on first paint).
- **Email follow-up to Vijay.** The 2026-06-18 draft mentions Wednesday as the next checkpoint. Once this plan is executed and zipped, attach `date-selector-1.2.0.zip` and the updated `SETUP.md` to that follow-up.
