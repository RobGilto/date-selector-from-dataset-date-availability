# Developer Documentation — NAB Date Selector

For engineers who will extend, debug, or hand off this Domo custom app
(case `05930295`).

Generated alongside an `understand-anything` knowledge graph at
`app/client/.understand-anything/knowledge-graph.json`. Every code
reference below ties back to a node in that graph; load the graph in the
dashboard (`/understand-anything:understand-dashboard`) to navigate
visually.

---

## 1. What this app does (10-second version)

A Domo App Studio custom card that:

- Reads dates from a bound dataset
- Renders a calendar (or sorted dropdown) — only dates present in the
  dataset are clickable
- On pick, fires `domo.requestVariablesUpdate` against a configured App
  Studio variable → cards on the same page filter accordingly
- Persists the variable configuration in a per-card AppDB collection

Single brick, single React component, no backend.

---

## 2. Stack

| Layer | Tech | Why |
|---|---|---|
| UI | React 18 + TypeScript | familiar, type-safe |
| Calendar | `react-day-picker` v9 | mature, themeable |
| Dates | `date-fns` v3 | timezone-safe ISO formatting |
| Domo bridge | `ryuu.js` v6 | postMessage iframe SDK |
| Build | Vite 5 | fast dev, small bundles |
| Persistence | Domo AppDB | per-card config + state docs |

Declared in `package.json` (`config:package.json` node). TypeScript
config split across `tsconfig.json` (source) and `tsconfig.node.json`
(Vite tooling).

---

## 3. Repository layout

```
app/client/
├── public/
│   ├── manifest.json                  ← Domo app manifest (config)
│   ├── sample-data.csv                ← Local-mock dataset
│   ├── sample-variables-registry.csv  ← Local-mock variable registry
│   └── thumbnail.png                  ← App icon
├── src/
│   ├── main.tsx                       ← React entry, mounts <App/>
│   ├── App.tsx                        ← Everything (1100+ lines, one file)
│   └── App.css                        ← Component styles + day-picker overrides
├── index.html                         ← Vite HTML entry
├── vite.config.ts                     ← Vite + React plugin
├── tsconfig.json, tsconfig.node.json  ← TS configs
├── package.json
├── README.md
└── docs/SETUP.md                      ← End-admin setup guide
```

Knowledge graph buckets these into **4 layers**:

1. **UI Layer** — `index.html`, `main.tsx`, `App.tsx`, `App.css`
2. **Configuration** — `package.json`, `tsconfig*`, `vite.config.ts`,
   `public/manifest.json`
3. **Local Mock Data** — `sample-data.csv`, `sample-variables-registry.csv`
4. **Documentation** — `README.md`

---

## 4. Initial setup (fresh clone)

```bash
git clone <repo>
cd app/client
npm install
npm run dev      # http://localhost:5173 — uses local CSV mocks
```

`IS_LOCAL` is `true` whenever `window.location.hostname` matches
`localhost` or `127.0.0.1`. In this mode `App.tsx`:

- Reads dates from `public/sample-data.csv` instead of the Domo data API
- Reads the variable registry from `public/sample-variables-registry.csv`
- Skips `domo.requestVariablesUpdate` calls (logs `[DEV] single pick: ...`
  instead)
- Stubs AppDB persistence via `localStorage`

This lets the full UI flow work offline before publishing.

---

## 5. Source-file deep dive

### 5.1 `src/main.tsx` (Application entry)

10 lines. Mounts `<App />` into `#root` with React StrictMode and imports
`App.css`. Touched almost never.

### 5.2 `src/App.tsx` (The whole app)

~1100 lines, one component. Reading top-to-bottom is the fastest way to
understand the brick. Key sections (search for the `// ──` dividers):

| Section | Lines (approx) | What lives there |
|---|---|---|
| Constants | top | `DATASET_ALIAS`, `DATE_COLUMN`, `VARIABLES_DATASET_ALIAS`, `DEFAULT_SINGLE_FID`, `HIDE_BETWEEN`, `IS_LOCAL` |
| Types | top | `ConfigDoc`, `StateDoc`, `DetectedVar`, `SelectionMode`, `ViewMode` |
| Helpers | top | `toISO`, `isoToDate` |
| Collection backend | top | localStorage shim for AppDB when `IS_LOCAL` |
| Variable registry | top | `resolveVarIds()` + `fetchLocalRegistry()` |
| Local data | top | `fetchLocalDates()` |
| Module-level detection | top | `registerVariablesListener` subscribes to `domo.onVariablesUpdated`; `discoverViaPageControls` hits page-controls REST API |
| Component | bottom | `App` — state, effects, handlers, render |

#### Function inventory (from the knowledge graph)

| Function | Purpose |
|---|---|
| `toISO(d: Date)` | `Date` → zero-padded `YYYY-MM-DD` local string |
| `isoToDate(iso: string)` | ISO → local-midnight `Date` (avoids UTC drift) |
| `fetchLocalRegistry()` | Parse `sample-variables-registry.csv` → `Map<name,fid>` |
| `resolveVarIds()` | Registry lookup; routes between localStorage and `domo.get` |
| `fetchLocalDates()` | Parse `sample-data.csv` for local mode date set |
| `registerVariablesListener()` | Subscribe to `domo.onVariablesUpdated`; ingest live variable name/fid/value tuples |
| `discoverViaPageControls()` | Fallback discovery via REST endpoint (currently 404s on NAB pages — kept for other tenants) |
| `App` | React component — orchestrates everything |

#### Key handlers inside `App`

| Handler | Triggered by | Effect |
|---|---|---|
| `loadSettings()` | mount | Reads config + state docs from AppDB, restores selection, re-fires variables via `rehydrateVariables` |
| `persistSettings(patch)` | settings edit | Write config doc to AppDB |
| `persistState(patch)` | date pick | Read-modify-write of state doc (so single + range picks don't clobber each other) |
| `handleSingleSelect(date)` | calendar/dropdown click | Update state, persist, `requestVariablesUpdate` |
| `applyRange()` | between mode (currently hidden) | Persist range, push start/end vars |
| `resetSettings()` | gear → Reset | Delete both docs, clear refs and UI state |
| `effectiveFid()` | every push path | Returns variable name→fid via registry, or legacy `functionId` fallback |

#### Two simultaneous variable-resolution paths

1. **Auto-detect (primary)** — `registerVariablesListener` captures
   `(functionId, name, value)` tuples from `domo.onVariablesUpdated`
   events. Settings panel renders these in a `<select>` grouped by
   "Date-typed" vs "Other detected" (heuristics: value matches ISO date
   regex, or name contains `date|month|day|year|period|till|start|end`).
   Admin picks one row → its `functionId` saves to `ConfigDoc.functionId`.
2. **Variable name registry (optional)** — `resolveVarIds()` queries the
   `variablesDataSet` alias for a `(Variable, VariableID)` table. Admin
   types a name into "Variable name (preferred)" → `effectiveFid()`
   resolves it. Survives function-ID churn. Skipped if alias unbound.

`effectiveFid()` checks registry first, falls back to raw `functionId`.

### 5.3 `src/App.css`

react-day-picker theme overrides (CSS custom properties), toolbar /
settings layout, list-view dropdown styling, mode toggle (hidden when
`HIDE_BETWEEN = true`).

### 5.4 `public/manifest.json` (Domo platform contract)

The single most important config file. Declares:

- `id` — design GUID (do NOT change after first publish)
- `version` — increment per release (e.g. `1.0.4`)
- `size` — default `2x1` card units
- `datasetsMapping`:
  - `sampleData` — the dataset whose `Date` column is surfaced. Customer
    rebinds during card add.
  - `variablesDataSet` — optional 2-column registry (`Variable`,
    `VariableID`). Empty `dataSetId` means customer can leave unbound;
    `resolveVarIds()` handles the 404 gracefully.
- `collectionsMapping` — `nab-date-selector-settings` AppDB collection
  with schema covering both `ConfigDoc` and `StateDoc` shapes. ADMIN
  read/write/delete, USER read.

### 5.5 `public/sample-data.csv`, `public/sample-variables-registry.csv`

Local-dev mocks. Domo runtime ignores them. Edit only if you need a
different local-test scenario.

---

## 6. Development workflow

### 6.1 Daily loop

```bash
cd app/client
npm run dev
```

Open `http://localhost:5173`. Code edits hot-reload. Pick dates, watch
console:

```
[DEV] single pick: 2024-08-15 (fid= 131272 )
[DEV] rehydrate variables: [Object]
```

### 6.2 Type-check / build

```bash
npm run build          # tsc + vite build → dist/
```

Run before every commit. CI may not exist, so this is the only gate.

### 6.3 First-time Domo CLI install

```bash
npm install -g ryuu     # global install
# OR per-project:
npx ryuu --version
```

### 6.4 Authenticate to a Domo instance

```bash
npx ryuu login -i <instance>.domo.com
```

A browser opens for SSO. Choose Domo Support / Customer SSO depending on
your role. ryuu writes session to
`~/.config/configstore/ryuu/<instance>.json` (one per instance — switch
instances by passing `-i` again).

**Token-based auth fallback:**

```bash
npx ryuu login -i <instance>.domo.com
# When prompted for "Developer token", paste a token generated at
# <instance>.domo.com → Admin → Authentication → Access Tokens.
```

Use this when SSO loops or for service accounts.

### 6.5 Publish a new version

```bash
cd app/client
npm run build
cp public/manifest.json dist/   # ryuu reads manifest from build root
cd dist
npx ryuu publish
```

First publish creates a new design and prints the GUID. **Save that
GUID back into `public/manifest.json` `id` field** so future publishes
update the same design rather than spawning duplicates.

```
"id": "4896fd53-0232-42d3-b31b-7be12b50e6ed"
```

### 6.6 Manual upload (zip path)

When CLI auth is painful or you only have UI access:

```bash
npm run build
cd dist
zip -r ../nab-calendar-X.X.X.zip .
```

Then in Domo: Asset Library → Apps → find design → **⋮** → **Upload
New Version** → drop zip.

### 6.7 Quick smoke after publish

1. Open the App Studio page hosting the brick → Edit mode
2. Click the card → side panel shows dataset bindings → confirm both
   aliases bound (`sampleData` required, `variablesDataSet` optional)
3. Open gear (⚙) → variable dropdown populates with detected variables
4. Pick one → close panel → pick a date in calendar
5. Cards filtered by that variable should refresh
6. Optional: capture a HAR to verify
   `queryOverrides.functionOverrides[<fid>]` is set on card render calls

---

## 7. AppDB collection schema (per-card persistence)

Collection name: `nab-date-selector-settings` (declared in manifest).

Two document types, discriminated by `type` field:

```ts
// Config doc — admin-set wiring
{
  type: 'config',
  variableName?: string,        // preferred (v1.2+)
  functionId?: number,          // legacy fallback
  mode?: 'single' | 'between',
  rangeStartFunctionId?: number,
  rangeEndFunctionId?: number
}

// State doc — last picked date(s)
{
  type: 'state',
  singleDate?: string,           // YYYY-MM-DD
  rangeStart?: string,
  rangeEnd?: string
}
```

`loadSettings()` queries the collection on mount, partitions docs by
`type`, hydrates refs + UI state, re-fires variables so cards restore
filter without user re-clicking.

Reset deletes both docs and clears refs.

---

## 8. Variable inclusivity (NOTE — v1.0.4 behaviour)

Historic versions shifted the pushed date by ±1 day to compensate for
exclusive downstream filters (`Date < vTillSelectedMonth`). **Removed in
v1.0.4** — brick now pushes the raw picked ISO date verbatim. Downstream
beast modes must use inclusive comparisons (`<=`, `>=`, `BETWEEN`).

If you need to bring back the shift, the helper was:

```ts
function addDays(iso: string, n: number): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
```

Check git history `git log -- app/client/src/App.tsx` for the original
implementation.

---

## 9. Hidden Between mode

`HIDE_BETWEEN = true` (top of `App.tsx`) masks the Single/Between mode
toggle UI. Code paths still work — flip to `false` and rebuild to
re-expose it. NAB stakeholders haven't justified the use case yet
(call 2026-06-04).

---

## 10. Branch / release conventions

- `main` — tagged releases only, FF merges
- `feat/<slug>` — feature branches off main
- Commit prefix style: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Manifest `version` increments on each publishable change (e.g.
  `1.0.3 → 1.0.4`)
- Zip filename: `nab-calendar-<version>.zip`

---

## 11. Knowledge graph cross-reference

| Concern | Files | Knowledge-graph node IDs |
|---|---|---|
| App boot | `index.html`, `main.tsx` | `file:index.html`, `file:src/main.tsx` |
| Core logic | `App.tsx` | `file:src/App.tsx` (+ 8 function nodes) |
| Styling | `App.css` | `file:src/App.css` |
| Domo manifest | `manifest.json` | `config:public/manifest.json` |
| NPM deps + scripts | `package.json` | `config:package.json` |
| TS config | `tsconfig.json`, `tsconfig.node.json` | `config:tsconfig.json`, `config:tsconfig.node.json` |
| Build | `vite.config.ts` | `file:vite.config.ts` |
| Local mocks | `sample-*.csv` | `table:public/sample-data.csv`, `table:public/sample-variables-registry.csv` |
| Onboarding docs | `README.md` | `document:README.md` |

Load the graph: `cat .understand-anything/knowledge-graph.json | jq` or
run `/understand-anything:understand-dashboard` to navigate visually.

---

## 12. Troubleshooting (developer-side)

| Symptom | Likely cause | Fix |
|---|---|---|
| `Failed to load resource: 404 /domo/environment/v1` | running locally — Domo iframe API absent | Expected. Only fires when `IS_LOCAL` is true. |
| `404 /api/content/v1/pages/{id}/variable/controls/list` in real Domo | page-level discovery endpoint missing for this page type | Expected on NAB pages. Auto-detect via `onVariablesUpdated` still works. |
| Detected dropdown empty in real Domo | no Date variables on page, or variables haven't fired their `onVariablesUpdated` event yet | Add a Date variable to the page; refresh card. |
| `requestVariablesUpdate` accepted but cards don't filter | downstream beast mode uses `<` not `<=` | Either fix the beast mode (preferred) or temporarily re-add the ±1 day shift in `handleSingleSelect`. |
| Picks don't persist across reload | AppDB collection schema mismatch | Bump manifest collection schema columns, republish; first new pick re-creates docs. |
| Vite build fails with TS error | strict mode catching real bug | Don't `--noEmit` skip. Fix the type. |
| Publish creates a NEW design instead of updating | manifest `id` field missing or wrong | Paste GUID from previous publish response into `manifest.json`. |

---

## 13. Support

Robert Gilto · `robert.gilto@domo.com` · SF Case **05930295**
