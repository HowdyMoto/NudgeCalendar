# Today — Desk Calendar

A minimal PWA that turns your phone into an always-on desk calendar. Connects to Google Calendar and shows today's events with live countdowns, color-coded urgency, overlapping meeting columns, and playful animations.

**Live app:** [https://howdymoto.github.io/Calendar/](https://howdymoto.github.io/Calendar/)

## Features

- **Live countdowns** — events shift from calm to urgent as they approach
- **All-day events** — shown as compact chips pinned to the top
- **Current meeting progress** — the card fills left-to-right as the meeting progresses
- **Wrapping-up nudge** — warm amber glow when 5 minutes remain in the current meeting
- **Meeting done celebration** — a delightful animation when a meeting ends
- **Overlapping meetings** — displayed side-by-side with staggered start times
- **Bounce animations** — upcoming events bounce with increasing urgency; tap to dismiss with a 3D press effect
- **Pull-to-refresh** — pull down to refresh events
- **Auto-refresh** — pulls new events every 5 minutes, resets at midnight
- **Screen wake lock** — keeps the display on while charging
- **PWA** — installs to your home screen, runs fullscreen with no browser chrome
- **Adjustable display size** — scale the UI up or down for your device
- **Color palettes** — choose your urgency color or use calendar colors
- **Google-branded sign-in** — properly branded OAuth button
- **Demo mode** — works out of the box with sample data (no Google account needed)

## Quick Start

### Use the hosted version

Visit [https://howdymoto.github.io/Calendar/](https://howdymoto.github.io/Calendar/) and sign in with your Google account.

### Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:8080` — you'll see sample events immediately.

To connect your real Google Calendar, create a `.env` file with your Google Client ID (see [SETUP.md](SETUP.md)).

## Desk Display Setup

1. Install the PWA on your phone (Safari → Share → Add to Home Screen, or Chrome → menu → Add to Home Screen)
2. **Android:** Enable Developer Options → "Stay awake" to keep the screen on while charging
3. **iOS:** Set up a Shortcuts automation to open the app when the charger connects
4. Place your phone on a stand or charger

Full instructions in [SETUP.md](SETUP.md).

## Development

```bash
npm run dev    # Dev server with auto-rebuild on file changes
npm run build  # Production build to dist/
```

Source files live in `src/`. The build step injects the Google Client ID and cache-busts assets into `dist/`.
