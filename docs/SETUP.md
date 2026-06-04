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

## Wire the variable ID

The brick can't auto-discover variables across the Domo sandbox boundary, so
you give it the variable's function ID once.

### Find the variable's function ID

1. Open the App Studio page that contains the card in **edit mode**.
2. Open the browser's developer console (`Cmd ⌥ J` on Mac / `Ctrl Shift J` on
   Windows).
3. In the card, click the **gear icon (⚙)** in the top-right corner.
4. Copy the snippet shown under "Discover variable IDs" and paste it into the
   console. Press Enter.
5. The console prints a table of every variable bound to the page, with
   columns `name`, `functionId`, `dataType`. Find the row for the variable
   your cards are filtered by (usually a Date variable — e.g.
   `vTillSelectedMonth`). Copy its `functionId`.

### Tell the brick

1. Back in the card's settings panel, paste the `functionId` into the
   **Single date variable ID** field.
2. Click **Save**. Settings panel closes; you'll see "Active: single=<id>"
   under the panel when you reopen it.
3. Pick a date in the calendar. Any card on the page filtered by that
   variable should refresh.

> **Tip:** Once the brick detects the variable on the page (you've opened
> the gear panel at least once), it stores the ID in the brick's own AppDB
> collection. End users never see this — they just see the calendar.

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
