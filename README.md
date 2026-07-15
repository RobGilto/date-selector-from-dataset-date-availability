# Date Selector — Domo Custom App

A Domo App Studio custom card that surfaces **only the dates present in
the bound dataset** and, on selection, **drives an App Studio variable**
(primary) and/or **emits a page filter** (optional). Beast-mode cards
that read the variable — or cards that filter by the picked column —
refresh automatically.

> **⚠ Required for the variable path:** the target variable must have a
> **page-level Variable Control on the App Studio page**. A custom-app
> card can only drive a variable the page already exposes via a control —
> without it, the update is accepted but never reaches the cards. See
> [`docs/SETUP.md`](docs/SETUP.md) Section 3.

- **Variable drive (primary)** — pushes a computed value (picked date,
  start-of-month, FY-start, …) to a named App Studio variable by name
- **Page filter (optional)** — `domo.filterContainer` on a dataset column
- **Dropdown default** — descending list of dates present in the dataset
- **Calendar option** — admin can switch view; only in-dataset days clickable
- **Editable date-format list** — admins add custom date-fns patterns via
  the gear; entries persist globally across every card instance
- **Per-card persistence** — variable, value formula, filter, view mode,
  and date format stored per Domo card id in AppDB collection
  `date-selector-settings`

## Current release

**v1.4.0** — variable-drive primary, page filter optional. See
[`docs/SETUP.md`](docs/SETUP.md) for the full admin walkthrough (add card
→ bind dataset → **add page Variable Control** → configure → pick format).

## Project links & tracking

| What | Link / ID |
|---|---|
| **Instance** | `nab-au.domo.com` |
| **App Studio page (live dashboard)** | https://nab-au.domo.com/app-studio/1292970502/pages/1611752341 |
| ↳ dataapp id | `1292970502` |
| ↳ page id | `1611752341` |
| **Design (Asset Library)** | https://nab-au.domo.com/assetlibrary?designId=4896fd53-0232-42d3-b31b-7be12b50e6ed |
| ↳ design id | `4896fd53-0232-42d3-b31b-7be12b50e6ed` |
| **Bound dataset** — DEV \| DS \| SAMPLE DATA | https://nab-au.domo.com/datasources/517ca1d7-3130-452b-926a-e4a6612212ee/details/overview |
| ↳ dataset id | `517ca1d7-3130-452b-926a-e4a6612212ee` |
| ↳ manifest alias / date column | `sampleData` / `Date` |
| **AppDB collection** | `date-selector-settings` |
| **GitHub repo** | https://github.com/RobGilto/date-selector-from-dataset-date-availability |
| **Salesforce case** | `05930295` |

### App Studio variables (NAB dashboard)

| Variable / beast mode | functionId | Role |
|---|---|---|
| `vMonthStart_test` | `132051` | Driven by the brick (start-of-picked-month). Upper bound for Monthly + YTD beast modes. |
| `vMonthStart` | `130340` | Production equivalent of the above. |
| `vFYStart` (beast mode) | `132052` | Derived: `CASE WHEN MONTH(vMonthStart_test) >= 10 THEN Oct 1 same yr ELSE Oct 1 prior yr` (NAB FY = **October**). |

> **Recommended NAB config:** variable `vMonthStart_test`, push value
> **Start of picked month**, **Page filter = none**. A page filter on the
> same page narrows rows and collapses YTD onto Monthly — keep it off for
> this dashboard.

### Publish (ryuu)

```bash
cd app/client
npm run build
cp public/manifest.json dist/manifest.json
cd dist && npx ryuu publish            # targets the most-recent ryuu instance
# if it prompts for the wrong instance, first:
#   npx ryuu token add -i nab-au.domo.com -t <DEV_TOKEN>
```

Dev tokens are short-lived — get a fresh one from
`nab-au.domo.com` → Admin → Security → Access Tokens when publish
returns "You do not have access to the design…".

## Status log

> Newest first. Update the **Now** block whenever you stop, so the next
> session can pick up cold. Keep it short — decisions and next action,
> not narration.

### 🟡 Now — pick up here

- **Deployed:** v1.4.0 live on nab-au (published 2026-07-13).
- **Open issue:** on the NAB dashboard, **Monthly Performance == YTD
  Performance** (both ≈ 13.70M).
- **Root cause (confirmed):** a **page filter is still applied** to the
  page — it narrows every card to a single month, so the YTD beast mode
  has no prior months to accumulate. The brick itself is correct
  (verified locally: variable-only config emits only the variable, no
  `filterContainer`).
- **Next action (on nab-au, needs SSO login — can't be done from the
  dev machine):**
  1. Brick gear → **Page filter (optional)** → **Filter column → none** → save.
  2. Top-right page **filter icon (badge 1/2)** → **remove every filter
     chip** (especially `Date`) — these persist even after the brick
     stops emitting.
  3. Reload → pick a date. Expect the bottom table to show **multiple
     month rows** and YTD > Monthly.
- **If still equal after clearing:** capture a fresh HAR of one date
  pick → trace whether `vFYStart` (132052) is recomputing from the
  driven `vMonthStart_test` (132051).
- **Recommended config:** variable `vMonthStart_test`, push **Start of
  picked month**, page filter **none**, FY start **Oct**.

### History

- **2026-07-15** — README: add Project links & tracking + this status log.
- **2026-07-13** — v1.4.0 published to nab-au. Settings cleanup:
  variable-drive primary, page filter demoted to optional/collapsed,
  removed diagnostic cruft (hardcoded id map, manual ID field, dead
  page-var discovery). Diagnosed Monthly==YTD as stuck page filter.
- **2026-07-03** — Root cause of "variable never drives cards" found: a
  **page-level Variable Control must exist** on the App Studio page for a
  custom-app card to drive a variable (docs-confirmed). Value must be ISO
  `YYYY-MM-DD`; functionId not needed once the control exists.
  Shipped v1.3.4–v1.3.10 (computed ranges MTD/CYTD/FYTD, hybrid
  variable+filter emit, value-formula selector).
- **2026-07-02** — v1.3.1 shipped: editable custom date formats in a
  shared collection. Docs rewritten around card-wiring flow.
- **2026-07-01** — v1.3.0: scrapped variable-drive, adopted
  `domo.filterContainer` page-filter emission (later reversed — variable
  path restored once the Variable Control requirement was understood).

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

## How variable drive works (v1.4, primary path)

1. **One-time setup** — a **page-level Variable Control** for the target
   variable must exist on the App Studio page. This is what registers the
   variable as driveable on the page; without it the value never reaches
   the cards.
2. **Admin picks variable + value formula** — gear panel: variable name
   (e.g. `vMonthStart_test`) + "Push what value" (picked date /
   start-of-month / FY-start / …).
3. **Date pick → drive** — brick computes the value and calls
   `domo.requestVariablesUpdate([{ name, value }])` with an ISO
   `YYYY-MM-DD` string. Every Beast Mode referencing the variable
   recomputes — Monthly, YTD, YoY, etc.
4. **Rehydrate on reload** — `loadSettings` re-drives the variable from
   the last picked date so cards restore without a manual re-click.

## How the optional page filter flows

1. **Column discovery** — the brick reads the bound dataset schema via
   `SELECT * FROM sampleData LIMIT 1` (locally: CSV header), cached 30 min.
2. **Admin picks column + operator** — under "Page filter (optional)":
   `Filter column`, `Filter operator` (`EQUALS` / `BETWEEN` /
   `LESS_THAN_EQUALS_TO` / `GREAT_THAN_EQUALS_TO` / computed `MTD` /
   `CYTD` / `FYTD`), `Data type`.
3. **Date pick → emit** — brick calls `domo.filterContainer([{column,
   operator, values, dataType}])`; cards filtered by that column refresh.
   An `isFiltersEmittedFromApp` echo guard prevents self-loops.

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
