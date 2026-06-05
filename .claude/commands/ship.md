---
description: Publish app/client/ to Domo via ryuu, sync design id
---

Ship the current state of `app/client/` to the configured Domo instance.

1. Confirm build passes: `cd app/client && npm run build`.
2. Publish from the build output: `cd app/client/dist && npx ryuu publish`.
3. On success, capture the design id from ryuu output and sync to `app/client/public/manifest.json` so subsequent publishes update the same design (avoid duplicate apps). Vite copies `public/manifest.json` into `dist/manifest.json` on every build, so the next `dist`-rooted publish will already have the right id.
4. Print: design id, publish status, customer instance URL to test.

WARNING: Publish must run from `app/client/dist/`, never from `app/client/`. The dev `index.html` at the project root references `/src/main.tsx`, and Domo cannot serve TypeScript sources — publishing from the project root will break the brick with a module-MIME error (`Failed to load module script ... application/octet-stream`).

If `ryuu login` is needed first, prompt the user — don't attempt non-interactively.
