# Chore: YYYY – MMM date label format

## Metadata
issue_number: ``
adw_id: ``
issue_json: ``

## Chore Description

Customer (NAB / Digvijay Moray, SF case 05930295) asked the date controller to render labels in `YYYY – MMM` format — e.g. `2026 – May` — instead of the current `May 2026` (calendar header) and `2026-05-12` (selected-date pill).

Scope is **display only**:

- Calendar header reads `2026 – MMM` (4-digit year, en-dash `–` U+2013, space, 3-letter English month).
- Selected-date pill (`.selected-display`) reads `YYYY – MMM` derived from the currently selected ISO date.
- The underlying selection value persisted to `sessionStorage`, written to the App Studio variable via `domo.requestVariablesUpdate`, and emitted in `<option>` values of the text-mode dropdown stays the canonical ISO `YYYY-MM-DD`. Do **not** change variable payloads.

The "Between" range mode lives in `specs/v1-iteration-yyyy-mmm-and-between.md` and is out of scope here.

## Relevant Files

Use these files to resolve the chore:

- `app/client/src/App.tsx` — single-file component holding both `MONTH_NAMES` (line 11), the calendar header render (`<span className="month-label">` ~ line 451), and the selected-date pill (`<span className="selected-display">` ~ line 349). All format changes happen here.
- `app/client/src/App.css` — only if `.selected-display` or `.month-label` need width/alignment tweaks once content gets longer (e.g. `2026 – May` is wider than `May`). Touch only if visual regression appears.
- `app/client/public/sample-data.csv` — input fixture for the IS_LOCAL mock; used to manually verify the format renders against real dates after `npm run dev`.
- `specs/v1-iteration-yyyy-mmm-and-between.md` — pre-existing spec capturing both customer asks; acceptance criteria for the format requirement live here too and must be cross-checked.
- `CLAUDE.md` — confirms active requirement #2 (YYYY-MMM label) and the `nab-au.domo.com` / functionId `131272` wiring; ensures we don't touch the variable contract.
- `.claude/commands/build.md` and `.claude/commands/ship.md` — execution context for the agent that will implement and publish the change.

### New Files

None.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add a short-month constant + helper in `App.tsx`

- After the existing `MONTH_NAMES` array (line 11) add `const SHORT_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];`.
- Just below `formatYMD` (line 29-31) add a pure helper:
  ```ts
  function formatYearMonthLabel(year: number, monthIndex: number): string {
    return `${year} – ${SHORT_MONTH_NAMES[monthIndex]}`;
  }
  ```
  Using the explicit `–` escape avoids editor encoding surprises while still emitting the en-dash character the spec requires.
- Add a second helper for the pill (which takes an ISO date string):
  ```ts
  function formatIsoToYearMonth(iso: string): string {
    if (!iso) return '';
    const [y, m] = iso.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return iso;
    return formatYearMonthLabel(y, m - 1);
  }
  ```
  The defensive fallback preserves the raw ISO string if a malformed date ever reaches the pill, so nothing breaks silently.

### 2. Switch the calendar header to the new format

- In the calendar render block (currently `<span className="month-label">{MONTH_NAMES[viewMonth]} {viewYear}</span>` ~ line 451) replace the inner expression with `{formatYearMonthLabel(viewYear, viewMonth)}`.
- Leave `MONTH_NAMES` in place — it is no longer referenced after this edit, so remove the now-unused `MONTH_NAMES` declaration to keep TypeScript strict happy (the file currently uses it only in the header).

### 3. Switch the selected-date pill to the new format

- In the toolbar block (`{selected && !showSettings && <span className="selected-display">{selected}</span>}` ~ line 349) change `{selected}` to `{formatIsoToYearMonth(selected)}`.
- Keep the `title` attribute path of `.selected-display` populated with the raw ISO so hover still shows the full `YYYY-MM-DD` for power users:
  ```tsx
  <span className="selected-display" title={selected}>{formatIsoToYearMonth(selected)}</span>
  ```

### 4. Leave variable + storage + dropdown payloads untouched

- Do **not** modify `selectDate` (~ line 314), `domo.requestVariablesUpdate`, `sessionStorage.setItem('nab-cal-selected', dateStr)`, or the text-mode `<option value={d}>{d}</option>` lines. The downstream Domo variable must remain ISO `YYYY-MM-DD`.
- Add a one-line comment immediately above the `selected-display` span: `// display-only: variable payload stays ISO YYYY-MM-DD` so the next reader knows the divergence is intentional.

### 5. Verify CSS still fits the wider label

- Run `npm run dev` (or use the `/start` slash command). Pick a date such as `2026-05-12` in the calendar.
- Confirm the header reads `2026 – May` and the pill reads `2026 – May` without truncation, overflow, or layout shift in the toolbar.
- If the header wraps or the pill overlaps the toolbar buttons, add a `min-width` / `white-space: nowrap;` rule to `.month-label` and/or `.selected-display` in `app/client/src/App.css`. Otherwise leave the CSS alone.

### 6. Update the spec acceptance checklist

- Edit `specs/v1-iteration-yyyy-mmm-and-between.md` and tick the existing checkbox `- [ ] Calendar header reads YYYY – MMM (en-dash).` to `- [x] ...` once the visual check in step 5 passes. Do not touch any other unchecked items — the Between work is still outstanding.

### 7. Run the Validation Commands

- Execute every command in the `Validation Commands` block below.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `cd app/client && npx tsc --noEmit` — TypeScript must compile clean (catches the now-removed `MONTH_NAMES` reference if step 2 was incomplete and any helper signature drift).
- `cd app/client && npm run build` — Vite production build must finish without errors or new warnings beyond the pre-existing CJS-API deprecation notice.
- `cd app/client && grep -n "MONTH_NAMES\[" src/App.tsx` — must return **no matches**; confirms the long-name lookup was fully replaced.
- `cd app/client && grep -n "\\u2013\\|formatYearMonthLabel\\|formatIsoToYearMonth" src/App.tsx` — must return at least 4 hits (constant declaration of the dash, two helper definitions, and the two call sites).
- `bash scripts/start.sh` (or `/start`) then open `http://localhost:5173/`, click a date in `public/sample-data.csv`'s range, and visually confirm:
  - Header label reads `<YYYY> – <MMM>` (en-dash, space-padded, 3-letter month).
  - Selected-date pill reads `<YYYY> – <MMM>` and its `title` attribute on hover still shows the raw ISO date.
  - Navigating prev/next month with `‹` / `›` keeps the new format and rolls year boundaries correctly (Dec ↔ Jan).
  - Text-mode dropdown options still display raw ISO `YYYY-MM-DD` (these are values, not labels — must not change).

## Notes

- The en-dash character is `–` (U+2013), not a regular hyphen `-`. The customer spec wording uses the en-dash; the existing `specs/v1-iteration-yyyy-mmm-and-between.md` also calls it out explicitly.
- Month abbreviations are locale-fixed to English to match the customer's screenshot and avoid pulling in `Intl.DateTimeFormat`, which would balloon bundle size and behave differently in the Domo iframe locale.
- The Domo App Studio variable contract (`vTillSelectedMonth`, functionId 131272, ISO date payload) is fixed by the customer's existing card configuration — any change to the payload format would break the downstream filter cards on `nab-au.domo.com`.
- There is no `app/server` in this project (Domo custom apps are client-only inside the Domo iframe); ignore the boilerplate `cd app/server && uv run pytest` step from the chore template.
- After validation passes, ship via `/ship` (see `.claude/commands/ship.md`) to publish to `nab-au.domo.com` and refresh the design id in `app/client/public/manifest.json`.
