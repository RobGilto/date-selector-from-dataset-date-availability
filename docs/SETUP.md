# Date Selector — Setup Guide

For NAB stakeholders (Case 05930295). Step-by-step to add the Date Selector
custom app to an App Studio page and wire it to your existing variable.

## What it does

Replaces the native Date control on an App Studio page. Shows a calendar (or
dropdown list) of **only the dates that exist in your bound dataset** — no
empty days are clickable. When a user picks a date, the app updates a Domo
variable; any card filtered by that variable refreshes.

## One-time install

1. Asset Library → Apps → **+ Add App** → **Upload Design** → drop the supplied
   `nab-calendar-dist.zip`.
2. Domo creates a new design called "Date Selector". Note the new design ID
   (or just find it by name later).
3. Open the design once. On the configuration screen, bind the dataset:
   - **Dataset alias:** `sampleData` (this is the brick's internal name — do
     not change)
   - **Source dataset:** select the dataset whose dates you want surfaced
   - **Required column:** `Date` (case-sensitive). Column must contain the
     dates you want users to pick.

## Add to an App Studio page

1. App Studio → open or create the page that will host the selector.
2. **+ Card** → **Custom App** → pick **Date Selector** from the list.
3. Place the card where the old date control was. Resize as needed; minimum
   useful size = 2×1 (two columns wide, one row tall).
4. The card will appear empty until you tell it which Domo variable to drive.

## Wire the variable (preferred: name-based via registry dataset)

v1.2 adds a **variable name registry** — a small dataset NAB maintains
listing every App Studio variable the brick is allowed to drive. The brick
resolves names to function IDs at runtime, so:

- Config reads in English (`vTillSelectedMonth`) instead of magic numbers.
- Function IDs can churn (App Studio rebuilds them on variable edits) —
  names stay stable.
- One dataset = one source of truth for every custom app you build later.

### 1. Create the registry dataset (one-time, ~5 minutes)

Two columns: `Variable` (the App Studio variable name, e.g.
`vTillSelectedMonth`) and `VariableID` (its function ID number).

Options to create it:

- **CSV upload via Workbench / File Upload Connector** — author a CSV with the
  two columns, upload it, name the resulting dataset `nab-variables-registry`
  (or whatever you prefer).
- **Magic ETL output** — if you want it data-driven, build a dataflow that
  pulls from an internal source. Otherwise CSV upload is fine.

Starter template lives in the brick zip under
`sample-variables-registry.csv` — use it as your column reference.

### 2. Find each variable's function ID

Per-page (page-level variables) and per-card (card-level variables) both use
the same `functionId` scheme. To capture them:

1. Open the App Studio page containing the card the brick will drive, in
   **edit mode**.
2. Click the **gear (⚙)** in the brick's top-right corner.
3. Copy the snippet shown under "Discover variable IDs" and paste it into
   your browser's dev console (`Cmd ⌥ J` / `Ctrl Shift J`). Press Enter.
4. Console prints a table — copy the `name` and `functionId` of each
   variable you want the brick to drive into your registry CSV.
5. Re-upload the CSV to refresh the dataset.

### 3. Bind the registry dataset to the brick

1. In App Studio, edit the card → **Dataset bindings** panel.
2. The brick exposes an alias called `variablesDataSet` (separate from
   the main `sampleData` binding).
3. Select your registry dataset for that alias.

### 4. Configure the brick

1. Click the **gear (⚙)** in the brick.
2. The **Variable name (preferred)** field has autocomplete — start typing
   the variable name; matches from the registry appear.
3. Click **Save**.
4. Pick a date in the calendar — cards bound to that variable refresh.

> **Tip:** The "Single date variable ID (legacy fallback)" field still
> works. If you fill that and leave Variable name blank, the brick uses the
> raw ID — same behaviour as v1.0/v1.1. Useful for quick smoke-tests
> before standing up the registry.

## Endpoint mode (advanced — usually leave default)

The brick supports two filtering styles. Toggle in the gear panel under
**Endpoint mode**:

- **Inclusive (default)** — shifts the pushed date by ±1 day so cards using
  `Date < vTillSelectedMonth` (exclusive comparison) still include the picked
  date. This matches NAB's current beast modes.
- **Raw** — pushes the picked ISO date verbatim. Use only if your downstream
  filter uses `BETWEEN ... AND ...`, `<=`, or `>=` (inclusive comparisons).

## Sandbox / security note

The variable-discovery snippet hits a single Domo endpoint
(`/api/content/v1/pages/{pageId}/variable/controls/list`) inside your own
tenant. It reads variable metadata only — no data rows, no content. Review
the snippet in `App.tsx` before running if your security team requires it.

The brick itself never makes outbound calls — it talks only to:
- The bound dataset, via Domo's data proxy
- The bound AppDB collection (`nab-date-selector-settings`) to persist the
  configured variable ID
- The Domo variable API to push the picked date

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| All dates greyed out | `Date` column missing or named differently | Check dataset has a column literally named `Date`. Re-bind. |
| Picked date doesn't filter cards | Variable ID not configured | Open gear → confirm `Single date variable ID` is set. Pick a date again. |
| Cards exclude the picked date | Downstream beast mode uses `<` not `<=` | Leave Endpoint mode = Inclusive. Brick will shift ±1 day automatically. |
| Want to wipe config | Bad variable ID stored | Gear → **Reset**. Removes both config and last-picked-date docs. |
| Dropdown shows oldest first | Old version | Update to current `nab-calendar-dist.zip`. List view sorts descending. |

## What's NOT included this release

- **Between (date range) mode** — built but hidden pending stakeholder
  use-case confirmation. We can re-enable with a one-line code flag once
  the requirement is locked in.

## Support

Robert Gilto · `robert.gilto@domo.com` · SF Case **05930295**
