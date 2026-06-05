# Date Selector — Domo Custom App

A Domo App Studio custom card that surfaces **only the dates present in
the bound dataset** and drives an App Studio variable on selection. Cards
filtered by that variable refresh whenever the user picks a date.

- **Calendar view** — months side-by-side; non-data days greyed out
- **List view** — descending dropdown of available dates
- **Persistence** — selected variable + last picked date stored in an
  AppDB collection (`date-selector-settings`)

## How variable wiring works

1. **Auto-detect (primary)** — the brick subscribes to
   `domo.onVariablesUpdated` at mount and ingests every variable
   (`functionId` + `name` + live value) that App Studio pushes to the
   card. The gear panel renders these in a dropdown grouped by
   "Date-typed" vs "Other detected". Admin clicks one row → saved.
2. **Manual variable ID (fallback)** — if the variable doesn't appear in
   auto-detect, paste its `functionId` into the "Single date variable ID"
   field.
3. **Dev-console snippet (last resort)** — when neither path works (rare,
   usually on legacy pages where the variable hasn't fired), the gear
   panel includes a one-liner you copy into the browser console on the
   host App Studio page; it prints a table of every variable's name +
   `functionId`. Paste the right ID into the fallback field above.

## Quick start (local dev)

```bash
cd app/client
npm install
npm run dev      # http://localhost:5173 — uses IS_LOCAL CSV mocks
```

## Build & publish to Domo

```bash
cd app/client
npm run build
cp public/manifest.json dist/
cd dist
npx ryuu publish    # first time: npx ryuu login -i <instance>.domo.com
```

After the first publish, paste the returned design GUID into
`app/client/public/manifest.json` under `id` so subsequent publishes
update the same design instead of creating a new one.

## Documentation

- [`docs/SETUP.md`](docs/SETUP.md) — admin install + per-page configuration
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — engineer-facing deep-dive
  (architecture, file index, dev workflow, troubleshooting)

## Stack

React 18 · TypeScript · Vite 5 · `ryuu.js` v6 · `react-day-picker` v9 ·
`date-fns` v3 · Domo AppDB Datastore.
