# Date Selector — Domo Custom App

A Domo App Studio custom card that surfaces **only the dates present in
the bound dataset** and emits a **page filter** on selection via
`domo.filterContainer`. Cards on the same page that filter by the picked
column refresh automatically. No variable wiring required.

> **Beast-mode implication:** page filters narrow the rows the beast mode
> sees. Cumulative logic (MTD, YTD, running totals) MUST be written to
> accept a filtered date set — a beast mode referencing a page variable
> is NOT driven by this brick (v1.3 drops the variable path entirely).

- **Dropdown default** — descending list of dates present in the bound dataset
- **Calendar option** — admin can switch view; only in-dataset days clickable
- **Editable date-format list** (v1.3.1) — admins add custom date-fns
  patterns via the gear; entries persist globally so every future
  card instance pulls from the same shared list
- **Per-card persistence** — filter column, operator, view mode, and
  chosen date format stored per Domo card id in AppDB collection
  `date-selector-settings`

## Current release

**v1.3.1** — see [`docs/SETUP.md`](docs/SETUP.md) for full admin
walkthrough (add card → bind dataset → configure filter → pick or add
date format).

## Documentation

- **User documentation** → [`docs/SETUP.md`](docs/SETUP.md) — admin
  install + per-page configuration walkthrough (audience: Domo admins
  dropping the brick on a page).
- **Developer documentation** → [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
  — engineer-facing deep-dive on architecture, file index, dev workflow,
  build + publish (ryuu / domo login), and troubleshooting (audience:
  anyone extending or debugging this codebase).

## How persistence works (zero-touch collection setup)

The AppDB collection is **declared in `manifest.json` under
`collectionsMapping`** (canonical name per the Domo docs is
`collections` — ryuu accepts both). Domo auto-provisions the collection
the first time the design is published into a tenant; the admin never
opens AppDB to create a collection or define a schema.

What happens on install:

1. Admin uploads the design (Asset Library → Apps → Upload Design) or
   publishes it via `domo publish`.
2. Domo reads the `collectionsMapping` entry, creates a collection
   literally named `date-selector-settings`, applies the declared schema
   (`type`, `variableName`, `functionId`, `mode`, range fields,
   `singleDate`, `rangeStart`, `rangeEnd`), and applies permissions
   (`ADMIN` read/write/delete, `USER` read).
3. The new collection appears in the card's **Wiring Screen** as a tab on
   the left — that's Domo's UI for inspecting AppDB docs per card.
4. Brick code calls `/domo/datastores/v1/collections/date-selector-settings/...`
   directly. No bootstrap step, no admin clicks.

Two documents live in the collection per configured card:

- **`type:"config"`** — admin-set filter wiring (`filterColumn`,
  `filterOperator`, `filterDataType`) + view/format preferences
- **`type:"state"`** — last picked date(s); used to restore selection and
  re-emit filter on reload

Reset (gear → Reset) deletes both docs. Schema changes in `manifest.json`
on a subsequent publish trigger a schema migration the next time the
design is installed.

> **Local-dev note:** AppDB calls from `domo dev` / `npm run dev` need a
> `proxyId` in the manifest so the proxy can route requests to a real
> deployed card. Get the proxyId from the URL of any card published from
> this design (format `XXXXXXXX-XXXX-4XXX-XXXX-XXXXXXXXXXXX`). The brick
> in this repo uses an `IS_LOCAL` localStorage shim, so a `proxyId` is
> only required if you want to test against real AppDB locally.

> **Note (v1.2+):** every card-instance writes its own config + state docs
> keyed by `domo.env.cardId`. Two cards on the same page hold independent
> settings — different variables, different date formats, different default
> views. Legacy unkeyed docs from pre-v1.2 deployments are still readable
> as a safety net during the upgrade.

## How page filters flow (v1.3)

1. **Column discovery** — on mount the brick reads the bound dataset
   schema via `SELECT * FROM sampleData LIMIT 1` (locally: reads the CSV
   header). Result cached in `localStorage` for 30 minutes.
2. **Admin picks column + operator** — gear panel `Filter column` select
   lists discovered columns; `Filter operator` picks `EQUALS` / `BETWEEN`
   / `LESS_THAN_EQUALS_TO` / `GREAT_THAN_EQUALS_TO`; `Data type` defaults
   to `DATE`.
3. **Date pick → emit** — brick builds
   `[{column, operator, values, dataType}]` and calls
   `domo.filterContainer(payload)`. Downstream cards on the same page
   filtered by that column refresh automatically.
4. **Echo guard** — an `isFiltersEmittedFromApp` boolean short-circuits
   the brick's own `onFiltersUpdate` listener so the emit does not loop.
5. **External round-trip** — when another card / filter sets the same
   column, the listener hydrates the brick's dropdown to match.
6. **Rehydrate on reload** — `loadSettings` re-emits the last picked
   date's payload so downstream cards restore without a manual re-click.

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

## Stack

React 18 · TypeScript · Vite 5 · `ryuu.js` v6 · `react-day-picker` v9 ·
`date-fns` v3 · Domo AppDB Datastore.
