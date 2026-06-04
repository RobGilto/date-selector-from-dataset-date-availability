# Bug: Domo publish serves un-built `index.html` referencing `/src/main.tsx`

## Metadata
issue_number: `are`
adw_id: `the`
issue_json: `console`

## Bug Description

After running `npx ryuu publish` from `app/client/` and opening the card in App Studio on `nab-au.domo.com` (page `1128411643`, design `4896fd53-0232-42d3-b31b-7be12b50e6ed`), the custom app surface renders blank. The browser console shows the fatal error:

```
main.tsx:1  Failed to load module script: Expected a JavaScript-or-Wasm module script
but the server responded with a MIME type of "application/octet-stream".
Strict MIME type checking is enforced for module scripts per HTML spec.
```

Expected: the calendar UI loads, header reads `YYYY – MMM`, dates from the bound `sampleData` dataset are selectable.

Actual: nothing in the brick iframe renders. The screenshot confirms the page-level controls render fine but the brick area is empty.

All other console lines in the bug report (403 on `appCatalystPrompt`, missing localized strings `datacenter/dremio-maestro`, `datacenter/dremio-customer-managed`, `workflow/annotation`, CSP report-only violations, `nfc` feature warning, Apollo dev-tools advert, sandboxed-iframe warnings) are **Domo platform noise** unrelated to this brick. They fire on every nab-au.domo.com page and predate the publish. Ignore them.

## Problem Statement

`ryuu publish`, run from `app/client/`, uploaded the **entire project tree** — including the un-built dev `index.html` at the repo root which contains `<script type="module" src="/src/main.tsx"></script>`. Domo serves that root `index.html` as the brick entrypoint. The browser then requests `/src/main.tsx`, which Domo returns with `Content-Type: application/octet-stream` because Domo's static-asset serving does not transpile TypeScript and does not map `.tsx` to a JS MIME type. The browser refuses to execute it under strict module MIME checking, so React never mounts.

The correct artifact — `dist/index.html` — references the compiled+hashed bundles `assets/index-ocHEG6Yg.js` and `assets/index-BmniQyVc.css` and would work, but Domo never sees it as the entrypoint because the root `index.html` shadows it.

## Solution Statement

Publish **only the contents of `dist/`** (the Vite build output) instead of the whole project. `dist/` already contains:

- `index.html` — references hashed JS+CSS bundles via `./assets/...`
- `assets/index-*.js` and `assets/index-*.css` — production-built code with the new `YYYY – MMM` helpers
- `manifest.json` — copied verbatim from `public/manifest.json` by Vite, already pinned to design id `4896fd53-0232-42d3-b31b-7be12b50e6ed`
- `sample-data.csv` and `thumbnail.png` — copied from `public/`

That set is self-contained, has no `/src/*.tsx` references, no `node_modules`, no `package.json`/`vite.config.ts` source-tree noise to confuse the proxy.

Two complementary tactical changes:

1. **Switch the publish command** to run from inside `dist/`. The `manifest.json` in `dist/` has the same design id, so `ryuu` will still patch (not duplicate) the existing design.
2. **Update `.claude/commands/ship.md`** so the documented workflow matches and future ship runs cannot regress.

Surgical only — no app code changes, no manifest changes, no dependency changes.

## Steps to Reproduce

1. `cd app/client`
2. `npm run build` (succeeds)
3. `npx ryuu publish` from `app/client/` — ryuu uploads `index.html`, `src/main.tsx`, `src/App.tsx`, `src/App.css`, `public/*`, `dist/*`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `README.md` (as observed in the publish output)
4. Open `https://nab-au.domo.com/app-studio/466965973/pages/1128411643` (or the pro-code-editor preview for design `4896fd53-0232-42d3-b31b-7be12b50e6ed`)
5. Open DevTools → Console. Observe `main.tsx:1 Failed to load module script: ... application/octet-stream`.
6. The brick area is blank.

## Root Cause Analysis

`ryuu publish` defaults to packaging every file in the current working directory (minus `node_modules` and a built-in ignore list) and uploading them to the design. The brick proxy then serves whatever `index.html` lives at the design root.

The `app/client/index.html` checked into the repo is the **Vite dev template**. Vite uses it as the entrypoint for `vite dev`, rewriting `/src/main.tsx` on the fly via its dev server. In production, Vite emits a *different* `index.html` into `dist/` with hashed bundle paths. The repo keeps the dev template at the root because Vite needs it for `npm run dev`.

When ryuu uploads both files to Domo, the root one wins (alphabetically or by directory depth — empirically, it's the one Domo serves at `/`). Domo has no Vite-equivalent dev server, so the `/src/main.tsx` request hits the static-file proxy, which returns the raw `.tsx` bytes with the default `application/octet-stream` MIME. Strict module MIME enforcement blocks execution → blank brick.

The previous V3 prototype likely shipped from a different layout (no Vite) or always published `dist/`. Either way, this is the first publish from the new TAC-7 layout, hence the regression.

## Relevant Files

Use these files to fix the bug:

- `app/client/index.html` — the dev Vite template with `<script type="module" src="/src/main.tsx"></script>`. Must not be uploaded to Domo. Keep it on disk for `vite dev`.
- `app/client/dist/index.html` — the correct production entrypoint emitted by `vite build`. Self-contained, references hashed assets in `./assets/`.
- `app/client/dist/manifest.json` — Vite copies `public/manifest.json` here; already pinned to design id `4896fd53-0232-42d3-b31b-7be12b50e6ed`. Confirms publishing from `dist/` updates the same design.
- `app/client/public/manifest.json` — source of truth for the manifest; do not edit.
- `app/client/vite.config.ts` — confirms `dist/` is the build output (default Vite behavior). No change needed.
- `app/client/package.json` — confirms the `build` script is `tsc && vite build`. No change needed.
- `.claude/commands/ship.md` — documented ship flow currently says `cd app/client && npx ryuu publish`. Must be updated to publish from `dist/`.
- `app/client/README.md` — sanity-check whether any quickstart instructions mention `ryuu publish` from a different directory.
- `CLAUDE.md` (project root) — confirms instance `nab-au.domo.com` and the active design id; nothing to edit here.

### New Files

None. The fix is one command-flow change plus one doc edit. No new scripts, no `.domoignore`, no manifest changes.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Confirm the bug locally before changing anything

- From `app/client/` run `grep -n "main.tsx" index.html`. Expect a hit on the `<script type="module">` line — confirms the dev template is the offending file.
- Run `grep -n "main.tsx\\|src/" dist/index.html`. Expect **zero** hits — confirms `dist/index.html` is safe.
- Run `cat dist/manifest.json | grep '"id"'`. Expect `"id": "4896fd53-0232-42d3-b31b-7be12b50e6ed"` — confirms publishing from `dist/` updates the same design rather than creating a duplicate.

### 2. Rebuild to make sure `dist/` reflects the current source

- From `app/client/` run `npm run build`. Must finish without TypeScript or Vite errors. (Smoke-checks that nothing about the previous `dist/` is stale.)

### 3. Re-publish from `dist/` instead of the project root

- `cd dist && npx ryuu publish`
- Watch the publish output. Expect the upload list to contain **only** `index.html`, `manifest.json`, `assets/index-*.js`, `assets/index-*.css`, `sample-data.csv`, `thumbnail.png`. There must be **no** `src/*.tsx`, **no** `package.json`, **no** `vite.config.ts`, **no** `node_modules`, and **no** root-level dev `index.html`.
- Confirm the success line still reports design id `4896fd53-0232-42d3-b31b-7be12b50e6ed`. If ryuu reports a new design id, abort — `dist/manifest.json` lost the `id` field somehow; restore it from `public/manifest.json` before retrying.

### 4. Verify in the customer instance

- Open `https://nab-au.domo.com/app-studio/466965973/pages/1128411643` in Chrome (incognito if cookies cache the bad build).
- Hard-refresh: Cmd-Shift-R.
- Open DevTools → Console.
  - **Must not** see the `Failed to load module script ... application/octet-stream` error referencing `main.tsx`.
  - The Domo-platform noise lines (403 on `appCatalystPrompt`, localized-string warnings, CSP report-only, `nfc` feature, sandboxed-iframe info, Apollo dev-tools advert) are acceptable — they fire on every nab-au page and are unrelated.
- In the brick, confirm:
  - Calendar renders.
  - Header reads `YYYY – MMM` (e.g. `2026 – May`).
  - Click an in-dataset date; the selected-date pill reads `YYYY – MMM`; its `title` attribute on hover is `YYYY-MM-DD`.
  - The variable update fires (check the App Studio variable panel — value should change to ISO `YYYY-MM-DD`).

### 5. Update `.claude/commands/ship.md` so the documented flow matches the fix

- Replace the existing step 2 (`cd app/client && npx ryuu publish`) with two steps:
  - `cd app/client && npm run build`
  - `cd app/client/dist && npx ryuu publish`
- Add a one-line warning under the step list: *"Publish must run from `app/client/dist/`, never from `app/client/`. The dev `index.html` at the project root references `/src/main.tsx` and Domo cannot serve TypeScript sources — publishing from the project root will break the brick with a module-MIME error."*
- Leave the design-id-sync step and the user-prompt-for-`ryuu login` notes intact.

### 6. Optional safety net (only if step 3 still picks up stray root files)

- If `cd dist && npx ryuu publish` still uploads unexpected files (some `ryuu` versions walk parent directories looking for `manifest.json`), add a `app/client/.domoignore` file containing:
  ```
  /index.html
  /src/
  /node_modules/
  /package.json
  /package-lock.json
  /tsconfig*.json
  /vite.config.ts
  /README.md
  ```
  and re-run `npx ryuu publish` from `app/client/` instead. Only do this if step 3's upload list is wrong — the `cd dist` form is the cleaner default and should work.

### 7. Run the Validation Commands below

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `cd app/client && grep -n "main.tsx\\|/src/" dist/index.html; test $? -eq 1` — must exit non-zero (no matches) → confirms the built entrypoint contains no `.tsx` source references.
- `cd app/client && grep -n "main.tsx" index.html` — must show the offending `<script type="module" src="/src/main.tsx">` line, confirming the dev template was correctly left alone on disk.
- `cd app/client && jq -r '.id' dist/manifest.json` — must print `4896fd53-0232-42d3-b31b-7be12b50e6ed`. Guarantees the next publish updates the existing design and does not duplicate it.
- `cd app/client && npm run build` — must finish without errors.
- `cd app/client && npx tsc --noEmit` — must finish clean.
- `cd app/client/dist && npx ryuu publish` — must succeed and report the same design id. Capture the upload list and confirm no `src/`, `package.json`, `vite.config.ts`, or root `index.html` entries.
- Manual browser check: open `https://nab-au.domo.com/app-studio/466965973/pages/1128411643`, hard-refresh, confirm:
  - No `Failed to load module script ... application/octet-stream` console error.
  - Calendar header reads `YYYY – MMM`.
  - Clicking an in-dataset date populates the App Studio variable (functionId `131272`) with an ISO `YYYY-MM-DD` value.
- (Optional but recommended) `playwright-validator` agent against `https://nab-au.domo.com/app-studio/466965973/pages/1128411643` — same checks as the local validation in this session, but against the real customer surface. Browser must be authenticated to nab-au (DomoSupport session is sufficient).

## Notes

- The publish output that triggered this bug listed the offending files clearly: `src/main.tsx`, `src/App.tsx`, `src/App.css`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig*.json`, `README.md`, and the dev `index.html` were all uploaded alongside `dist/*`. Future regressions will show up the same way — eyeball the publish output every time.
- Domo's brick proxy serves whatever filename matches the request literally. There is no Vite-equivalent transformation, no module bundling, no TypeScript compilation. Only the **built** Vite output is safe to publish.
- The CSP `report-only` and sandboxed-iframe warnings in the report are Domo platform behavior — they fire on every App Studio page regardless of any custom brick. They are not actionable from this brick.
- The 403 on `/api/customer/v1/properties/appCatalystPrompt` is a Domo internal feature-flag probe; it is allowed to 403 for instances without that property set. The Domo bootstrap explicitly handles the 403 (`[App Catalyst] appCatalystPrompt property not set, continuing normal bootstrap.`). Not actionable.
- The missing-localized-string warnings (`datacenter/dremio-maestro`, `datacenter/dremio-customer-managed`, `workflow/annotation`) are Domo platform i18n gaps. Not actionable from this brick.
- The thumbnail warning from the earlier publish (`A thumbnail is required ... Place a 300x300 image named thumbnail.png`) is unrelated to this bug but should be cleaned up later: replace `app/client/public/thumbnail.png` with a 300×300 PNG so the card has a proper Appstore/mobile thumbnail.
- After this fix lands, also consider committing the in-flight 46 staged files (the repo still has no first commit per the session-handoff note in `MEMORY.md`) so the working baseline is preserved.
