---
description: Implement a spec from specs/ in app/client/
---

Build the spec named $ARGUMENTS (path under `specs/`).

Workflow:
1. Read the spec file `specs/$ARGUMENTS.md` (or full path if given).
2. Implement in `app/client/src/`. Match existing style — function components, hooks, ryuu.js v6.
3. After changes: `cd app/client && npm run build` — must pass with zero TS errors.
4. If build fails: fix root cause, re-run. No `--skip-checks` or `// @ts-ignore`.
5. Update the spec's Acceptance checklist as items complete.
6. Report: files changed, build status, remaining acceptance items.

No publishing. Stop after build passes.
