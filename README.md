# AGNDA (2026)

AGNDA is a fast agenda timer for solo deep-work sessions or live meetings.

- Built with Vite + React (modernized from the old CRA app)
- Keyboard-first flow (`Space` to start/pause, `Cmd/Ctrl + N` to add a topic)
- Legacy-safe migration for old AGNDA saved sessions
- Deploy script wired for:
  - [agnda.kenlauguico.com](https://agnda.kenlauguico.com/)
  - [agnda.kenlaugui.co](https://agnda.kenlaugui.co/)

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Scripts

```bash
npm run dev        # Local development
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
npm run test       # Vitest test run
```

## Legacy Compatibility

This refactor keeps old session data usable.

What is migrated:
- Old topic arrays (`topics`) including `name`, `seconds`, `elapsed`
- Old index field (`currentNumber` -> `currentIndex`)
- Old auto-advance field (`autoTopic` -> `autoAdvance`)

Legacy storage keys covered:
- `window.location`-based keys from `redesign/2022`
- common historical variants (`agnda:state`, `agnda-state`, `agenda-state`)
- URL-looking storage keys that may contain prior AGNDA data

Migration behavior:
- legacy running sessions are resumed in a paused state to avoid large elapsed jumps after long offline gaps.

## Hash Link Support

AGNDA supports two URL hash styles:

- Legacy: `#25/Topic A/Topic B` (minute-lock format)
- New: `#v2/<encoded-json>` for full-fidelity shared agendas

The "Copy share link" button generates the new `#v2` format.

## Deploy

`deploy.sh` follows the same deployment pattern as your other `/scratch` projects:
- local build
- `dist/` sync with `rsync`
- optional PM2 static process check/restart

Run:

```bash
./deploy.sh
```

Default deploy target config:

- `SERVER_USER=root`
- `SERVER_HOST=kenlauguico.com`
- `REMOTE_PATH=/agnda`
- `APP_PROCESS_NAME=static-page-server-8081`
- `APP_PORT=8081`

You can override any of these via environment variables.

## Stack

- React 19
- Vite 5
- Vitest + Testing Library
- CSS custom properties with responsive, animation-aware UI
