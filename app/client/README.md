# Date Selector from Dataset Date Availability

A pro-code Domo custom app that renders a **calendar grid** (or compact dropdown) of dates available in a dataset. Selecting a date writes to a Domo App Studio page variable so other cards on the page filter accordingly.

Dates with no data are greyed out — only dates that exist in the dataset are clickable.

## Stack

- React 18 + TypeScript + Vite
- [`ryuu.js`](https://www.npmjs.com/package/ryuu.js) v6 — Domo brick SDK
- AppDB Datastore — persists the variable `functionId` per app instance

## Prerequisites

- Node.js 18+
- Domo CLI (`ryuu`):
  ```bash
  npm install -g ryuu
  ```
- A Domo instance you can publish custom apps to
- An App Studio page that already has the page variable you want to drive

## Local development

The app supports a local mock so you can iterate on UI without publishing:

```bash
npm install
npm run dev
```

When `window.location.hostname === 'localhost'`, the app reads dates from `public/sample-data.csv` instead of calling the Domo dataset API. The variable write call is also skipped locally.

## Build & publish to Domo

1. Log in once per Domo instance:
   ```bash
   domo login
   # follow the OAuth prompt, target the right instance (e.g. yourcompany.domo.com)
   ```

2. Build and publish:
   ```bash
   npm run build
   cp public/manifest.json dist/
   cd dist
   domo publish
   ```

   First publish creates the design and prints a URL like:
   ```
   Design can be found at https://<instance>.domo.com/assetlibrary?designId=<UUID>
   ```

3. **Save the generated `id` back to `public/manifest.json`** so subsequent publishes update the same design instead of creating a new one:
   ```json
   "id": "<UUID-from-publish-output>"
   ```

4. Re-publishing same design — bumping `version` is optional but recommended for traceability.

## Configure for a new page

The app needs to know **which page-level variable** to write to. The variable's `functionId` is stored once in AppDB and shared across all viewers of the dashboard.

### Step 1 — Add the app to a page

In App Studio, drag the brick onto a page that has at least one page-level variable.

### Step 2 — Find the variable's `functionId`

Open the gear icon in the deployed app, click **Copy** next to the snippet, then paste it into the browser DevTools Console (on the **main page**, not the iframe).

The exact snippet (also shown in the gear panel):

```js
(async()=>{const m=location.pathname.match(/\/pages?\/(\d+)/);if(!m)return console.error("not on a Domo page");const r=await fetch(`/api/content/v1/pages/${m[1]}/variable/controls/list`);const d=await r.json();const rows=(Array.isArray(d)?d:d.controls||[]).map(c=>({name:c.function?.name||c.name||"?",functionId:c.function?.id||c.functionId,dataType:c.function?.dataType||c.dataType||"?"}));console.table(rows)})()
```

A clean table prints, e.g.:

| name | functionId | dataType |
|---|---|---|
| myDateVariable | 131272 | DATE |

Copy the `functionId` of the variable you want to drive.

### Step 3 — Save it in the app

1. Click the **gear icon** in the toolbar of the deployed app
2. Paste the `functionId` into the input
3. Click **Save**

The value is persisted to AppDB and survives reloads. Done — viewers see the calendar wired to that variable.

### Step 4 — Connect the dataset

In App Studio, the brick exposes a dataset alias `sampleData`. Map it to whichever dataset has the dates you want to surface as available days.

The app queries:

```ts
domo.get(`/data/v1/sampleData?fields=Date`)
```

So the dataset needs a column literally named `Date` (or update `DATE_COLUMN` in `src/App.tsx`).

## Manifest fields

```json
{
  "name": "Date Selector",
  "version": "1.0.0",
  "fullpage": false,
  "size": { "width": 2, "height": 1 },
  "datasetsMapping": [
    { "alias": "sampleData", "dataSetId": "<your-dataset-id>", "fields": [] }
  ],
  "collections": [
    {
      "name": "date-selector-settings",
      "schema": { "columns": [{ "name": "functionId", "type": "LONG" }] },
      "permissions": [
        { "role": "ADMIN", "actions": ["READ", "WRITE", "DELETE"] },
        { "role": "USER", "actions": ["READ"] }
      ]
    }
  ],
  "id": "<design-id-from-first-publish>"
}
```

- **`name`** — display name in Domo Asset Library
- **`datasetsMapping[0].dataSetId`** — the dataset for your page
- **`collections[0].permissions`** — only Admins can change settings; viewers read only

## Permissions model

| User | Can configure? | Can use? |
|---|---|---|
| App owner / Admin | ✅ Save + Reset in gear panel | ✅ |
| Dashboard viewer | ❌ (silently fails) | ✅ Inherits owner's setting |

Shared settings live in the AppDB collection defined in the manifest, scoped to the app instance.

## Troubleshooting

| Problem | Fix |
|---|---|
| Calendar shows current month with all dates greyed out | Dataset has no rows for that month — navigate the calendar back/forward to a month with data |
| Date click doesn't filter the KPI card | Either no `functionId` saved (open gear → set it) **or** the brick is on a Dashboard not App Studio (move it to App Studio for variable updates to fire) |
| `404 DA0093: Resource not found` in console | The brick proxy doesn't whitelist `/api/content/v1/...`. Manual entry via gear is the supported path. |
| App reloads in a loop | Check the brick is on a page where the dataset isn't filtered by a different variable (causes recursive `onDataUpdated`). |

## Files

```
src/
  App.tsx        # Main component: calendar grid, dropdown toggle, settings panel
  App.css        # Layout + theme
  main.tsx       # React root
public/
  manifest.json  # Domo app manifest
  sample-data.csv# Local dev mock data
```

## License

MIT.
