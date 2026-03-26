# Changelog

## 2026-03-26

### Added
- **Build system** — `npm run build` produces a production build in `dist/` with cache-busted assets and auto-generated icons
- **Dev server** — `npm run dev` with auto-rebuild on file changes
- **GitHub Actions deployment** — auto-deploys to GitHub Pages on push to master
- **All-day event chips** — all-day events shown as compact horizontal chips pinned to the top
- **Current meeting highlight** — glowing card with subtle pulse animation using the chosen palette color
- **Display size slider** — scale the UI up or down; card border radius shrinks proportionally
- **Path traversal protection** — dev and serve scripts validate file paths stay within `dist/`

### Changed
- **Source files moved to `src/`** — app code lives in `src/`, build tooling stays at root
- **Slider thumb enlarged** — 32px touch target for easier use on phones
- **Card borders removed** — cleaner look without borders on event cards
- **Docs updated** — README and SETUP.md reflect new build workflow, deployment, and Android setup

### Removed
- Dead CSS variables (`--upcoming-glow`, `--imminent`, `--imminent-glow`)
- Unused `urgencyBorderAlpha()` function and related dead code
- Redundant `prevWasAllDay` tracking after all-day event refactor

### Fixed
- Extracted shared static file server to `lib/static-server.js` to eliminate duplication between `serve.js` and `dev.js`
- Build script now reads `GOOGLE_CLIENT_ID` from environment variables (for CI) in addition to `.env`
