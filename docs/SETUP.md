# Date Selector — Setup Guide

For NAB stakeholders (Case 05930295). Drop-in date control that replaces
Domo's native date filter and drives any App Studio variable on the page.

---

## What it does

- Renders a calendar (or dropdown list) showing **only the dates present in
  the bound dataset** — empty days greyed out.
- When a user picks a date, the brick fires `requestVariablesUpdate` on the
  configured variable. Any card filtered by that variable refreshes.
- Configuration is **per-card** and **persists** in an AppDB collection.
  Admin sets it once; end users see only the calendar.

---

## 0. Prereqs

- App design **Date Selector** already exists in your tenant (id
  `4896fd53-0232-42d3-b31b-7be12b50e6ed`). If not, upload
  `nab-calendar-1.0.4.zip` via Asset Library → Apps → ⋮ → Upload Design.
- Dataset with a `Date` column (literal name, case-sensitive).
- At least one App Studio Date-typed variable on the page that some cards
  use as a filter (e.g. `vTillSelectedMonth`).

---

## 1. Add the card to an App Studio page

1. App Studio → open the page (Edit mode).
2. **+ Card** → **Custom App** → search **Date Selector**.
3. Place the card; minimum useful size 2×1.
4. **Domo will prompt for the dataset** as part of adding the card —
   the right-hand panel shows a dataset picker.
   - Pick the dataset whose dates you want surfaced. Required column:
     `Date` (literal name, case-sensitive).
   - This wires up the brick's `sampleData` alias. You won't see the
     word "bind" — it just looks like picking a data source. That's it.
5. If a second alias `variablesDataSet` is shown, **skip it** (leave
   unbound). Auto-detect handles single-variable cases without it. It's
   only useful for advanced multi-app registries.

---

## 2. Configure which variable to drive (admin, one-time)

1. Click the brick's **gear ⚙** (top-right of the card).
2. Settings panel opens. The first section is **Variable Configuration**.
3. The dropdown labelled "Detected on this page" lists every App Studio
   variable that's pushed a value to this brick on load. Two groups:
   - **Date-typed** — variables whose live value looks like an ISO date
     OR whose name contains `date|month|day|year|period|till|start|end`.
     These are what this brick is designed to drive.
   - **Other detected** — non-date variables, surfaced for fallback in
     case the heuristic misses something.
4. Pick the variable that drives your filtered cards. For NAB this is
   typically **`vTillSelectedMonth`** (functionId `131272`).
5. Selection auto-saves to the brick's AppDB collection
   (`nab-date-selector-settings`). Panel can be closed.
6. Verify the green confirmation line at the bottom of the panel:
   `Active: single=131272, start=none, end=none`

> **Persistence:** the chosen variable is stored per-card in AppDB.
> Refreshing the page, signing out, or switching between devices keeps the
> same configuration. End users never see the gear panel unless an admin
> opens it.

---

## 3. End-user behaviour

- **Calendar view (default)** — months side-by-side; only in-dataset days
  are clickable. Headers render as `2026 – Sep` (YYYY – MMM).
- **List view (≡ icon)** — dropdown listing every available date,
  descending (latest first), formatted `YYYY – MMM – DD`.
- Picking a date pushes the raw ISO date to the configured variable.
  Filtered cards re-render.

---

## 4. Re-configure or clear

- **Change the variable:** gear ⚙ → pick a different entry from the
  dropdown → auto-saves.
- **Wipe configuration:** gear ⚙ → **Reset**. Both the config doc and
  any persisted picked date are deleted from AppDB.

---

## 5. Sandbox / security notes

- The brick lives inside Domo's standard custom-app iframe sandbox.
- Variable detection uses Domo's documented `domo.onVariablesUpdated`
  event — no DOM scraping, no private REST endpoints.
- The settings panel offers a manual "Discover variable IDs" snippet (a
  one-liner you paste into the browser console). It only hits the Domo
  page's `variable/controls/list` endpoint and prints names + IDs to your
  console. No data leaves your tenant. Review the code in `App.tsx` if
  your security team requires it.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Every day greyed out | `Date` column missing or differently named | Confirm bound dataset has a literal `Date` column. Re-bind. |
| Picking a date doesn't filter | No variable selected in gear panel | Open gear → pick from dropdown → reload card. |
| Wrong variable selected | Date-typed heuristic misclassified or someone hit the wrong row | Reopen gear → pick again. Auto-saves. |
| Cards exclude the picked date | Downstream beast mode uses `<` not `<=` | Update the beast mode to `<=`. Brick now pushes raw dates (no compensation). |
| Dropdown is empty | Page has no Date-typed variables, or they haven't fired to the iframe yet | Add a Date variable to the page in App Studio. Save the page; refresh. |
| Dropdown sort order wrong | You're on a pre-1.0.3 version | Upload the latest zip via Asset Library. |
| Want to wipe config | Bad setup, starting over | Gear → Reset. |

---

## What's NOT in this release (v1.0.4)

- **Between (date range) mode** — built but hidden pending stakeholder
  use-case confirmation. Re-enable with a one-line code flag.
- **Driving multiple variables in one pick** — single variable per card
  only. Add a second card or wait for v1.1 if multi-target needed.
- **Variable name registry** — `variablesDataSet` alias is wired but
  optional. Use for ID-churn resilience or cross-app reuse only.

---

## Support

Robert Gilto · `robert.gilto@domo.com` · SF Case **05930295**
