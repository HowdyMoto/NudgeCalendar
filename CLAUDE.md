# Nudge Calendar

A minimal PWA that turns your phone into an always-on desk calendar. Connects to Google Calendar and shows today's events with live countdowns, playful animations, and color-coded urgency.

## Dev Workflow

- `npm run dev` — Vite dev server on port 8080 (matches OAuth redirect config)
- `npm run build` — generates icons + production build to `dist/`
- `.env` must contain `VITE_GOOGLE_CLIENT_ID=<your client id>`
- Deployed to GitHub Pages via `.github/workflows/deploy.yml`

## Architecture

Vanilla JS (no framework), Vite build, ES modules. All source is in `src/`:

- `app.js` — Entry point, bootstrap, window globals for inline handlers
- `config.js` — Constants, env vars, DEMO_MODE flag
- `state.js` — Shared mutable state with setter functions
- `auth.js` — Google OAuth (login, logout, silent reauth)
- `api.js` — Google Calendar & Tasks API, profile photo fetching
- `render.js` — Time grid, event card HTML, DOM diffing
- `colors.js` — Calendar color palettes, urgency-based opacity/contrast
- `animations.js` — Emoji physics animation, event dismiss interaction
- `briefing.js` — Morning briefing overlay
- `settings.js` — Settings panel, display scale, tasks toggle
- `timers.js` — Render/refresh intervals, midnight reset
- `ui.js` — Screen management, scroll tracking, pull-to-refresh, wake lock, service worker
- `demo.js` — Demo mode sample data
- `utils.js` — Shared pure helpers (escapeHtml, formatCountdown, etc.)

Static assets live in `public/` (copied as-is to dist). `index.html` is at the project root (Vite entry point).

## Versioning

Bump the version in `package.json` on every push:
- **Patch** (2.0.x): bug fixes, styling tweaks, copy changes, refactors
- **Minor** (2.x.0): new user-facing features or behavior changes
- **Major** (x.0.0): breaking changes, large rewrites, or architectural shifts

When committing, update the `"version"` field in `package.json` as part of the commit.
