# Date Selector — Domo Custom App

A Domo App Studio custom card that surfaces **only the dates present in
the bound dataset** and drives an App Studio variable on selection. Cards
filtered by that variable refresh whenever the user picks a date.

- **Calendar view** — months side-by-side; non-data days greyed out
- **List view** — descending dropdown of available dates
- **Auto-detect** — the brick discovers page variables via
  `domo.onVariablesUpdated`; admin picks one in the gear panel
- **Persistence** — selected variable + last picked date stored in an
  AppDB collection (`date-selector-settings`)

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
