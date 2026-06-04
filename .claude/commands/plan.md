---
description: Generate implementation spec for a feature in this Domo custom app
---

Read `CLAUDE.md` + any open spec under `specs/`. For the feature described in $ARGUMENTS:

1. Identify which files in `app/client/src/` change.
2. Draft a spec file at `specs/<slug>.md` with Context / Requirements / Acceptance sections.
3. Reference existing patterns: `ryuu.js` v6 (`domo.get`, `domo.requestVariablesUpdate`, `domo.onDataUpdated`, `domo.onVariablesUpdated`), App Studio variable functionIds.
4. Note IS_LOCAL mock data needs if the change requires new dataset columns.
5. Print the spec path and one-paragraph summary.

Don't write code. Spec only.
