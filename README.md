# Date Selector — Domo Custom App

A Domo App Studio custom card that surfaces **only the dates present in
the bound dataset** and drives an App Studio variable on selection. Cards
filtered by that variable refresh whenever the user picks a date.

- **Calendar view** — months side-by-side; non-data days greyed out
- **List view** — descending dropdown of available dates
- **Persistence** — selected variable + last picked date stored in an
  AppDB collection (`date-selector-settings`)

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

- **`type:"config"`** — admin-set variable wiring (`functionId` or
  `variableName`)
- **`type:"state"`** — last picked date(s); used to restore selection on
  reload

Reset (gear → Reset) deletes both docs. Schema changes in `manifest.json`
on a subsequent publish trigger a schema migration the next time the
design is installed.

> **Local-dev note:** AppDB calls from `domo dev` / `npm run dev` need a
> `proxyId` in the manifest so the proxy can route requests to a real
> deployed card. Get the proxyId from the URL of any card published from
> this design (format `XXXXXXXX-XXXX-4XXX-XXXX-XXXXXXXXXXXX`). The brick
> in this repo uses an `IS_LOCAL` localStorage shim, so a `proxyId` is
> only required if you want to test against real AppDB locally.

> **Caveat:** all instances of the brick on the same Domo tenant share
> the same collection. The brick currently assumes one configured doc
> set per tenant — multiple cards on different pages will read each
> other's docs. Document keying per card-instance is a future
> enhancement.

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
