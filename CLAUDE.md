# NAB Calendar — Domo Custom App (Case 05930295)

Customer: **National Australia Bank (NAB)** — instance `nab-au.domo.com` (prod8)
Contact: Digvijay Moray <digvijay.moray@nab.com.au>
SF Case: **05930295** — App Studio Date Controller: show only dates with data

## Purpose

Domo App Studio custom card that surfaces only the dates with data from the bound dataset, replacing the default date controller. Updates an App Studio variable on selection.

## Layout (TAC-7 ADW style)

```
app/
  client/        # React + Vite + TS + ryuu.js v6 — the custom app
adws/            # AI Developer Workflow drivers (plan / build / ship)
specs/           # Implementation specs feeding ADW
ai_docs/         # Domo/ryuu/App Studio reference docs for AI
app_docs/        # Customer screenshots, HARs, requirement notes
.claude/
  commands/      # Project slash commands
_archive_initial_scaffold/  # Empty 29-Apr ryuu init — kept for reference
```

No `app/server/` — Domo custom apps run client-only inside the Domo iframe. Backend = Domo platform via `ryuu.js` (`domo.get`, `domo.requestVariablesUpdate`, etc.).

## Active requirements (from customer 2026-05-19)

1. Calendar shows only dates present in dataset (built ✓ in V3 prototype — needs verify in new structure)
2. **NEW** — date label format `YYYY-MMM` (e.g. `2026 – May`)
3. **NEW** — "Between" selection mode (pick a period, similar to card filter)
4. Schedule call to walk through prototype + next steps

## App Studio wiring

- Bound dataset alias: `SampleData` (placeholder — confirm customer's real alias)
- Variable function ID: **131272** (`vTillSelectedMonth`)
- Variable type: date

## ADW workflow

```bash
cd adws
uv sync
uv run adw_plan_iso.py <issue_no>
uv run adw_build_iso.py <issue_no> <adw_id>
uv run adw_ship_iso.py  <issue_no> <adw_id>
```

See `adws/README.md` for full details.

## Related

- Parent SF case lives in V5: `~/codebaseV5/app/server/data/cases/nab/05930295/`
- V3 prototype source: `~/archieve/codebaseV3/nab/05930295/calendar-app/` (copied into `app/client/`)
- `domo-ai-vibe-rules/` sibling dir = separate repo with vibe rules; gitignored here
