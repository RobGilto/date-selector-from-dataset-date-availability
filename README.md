# NAB Calendar — Domo Custom App

Custom App Studio card for NAB (Case 05930295). Date controller surfacing only dates with data, drives an App Studio variable.

## Quick start (client)

```bash
cd app/client
npm install
npm run dev      # local dev — uses IS_LOCAL CSV mock if configured
```

Publish via ryuu:

```bash
cd app/client
npx ryuu login    # one-time
npx ryuu publish
```

## ADW

```bash
cd adws
uv sync
cp .env.sample .env   # add ZAI_API_KEY
uv run adw_sdlc_zte_iso.py <github_issue_no>
```

See `CLAUDE.md` for full project context.
