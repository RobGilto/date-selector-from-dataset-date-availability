---
description: Start Vite dev server for app/client (http://localhost:5173)
---

Run the dev server via the project script.

Execute in background so the session stays interactive:

```bash
bash scripts/start.sh
```

Use `run_in_background: true` when invoking. After launch, tail a few log lines to confirm Vite is up on http://localhost:5173/. If port 5173 is busy, Vite auto-picks the next free port — report the actual URL from the log.

Pass-through args go to `npm run dev`, e.g.:

```bash
bash scripts/start.sh -- --host 0.0.0.0
```
