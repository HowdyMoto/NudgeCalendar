# Nudge

A PWA that makes sure you never miss a meeting. Connects to Google Calendar and shows your day in an Apple/Google Calendar-style view, with playful animated alerts that nudge you before, during, and at the start of each day.

**Live app:** [https://howdymoto.github.io/NudgeCalendar/](https://howdymoto.github.io/NudgeCalendar/)

## Features

### Meeting alerts
- **Morning briefing** — on first open of the day, meetings cascade in one-by-one with bounce animations; tap "Got it" to acknowledge your schedule
- **Active meeting acknowledgment** — meetings already in progress bounce until you tap them, so you know you're supposed to be in one
- **Approaching meeting alerts** — upcoming events bounce with increasing urgency at 30, 15, and 3 minutes out; tap to dismiss with a 3D press effect
- **Wrapping-up nudge** — pulse animation when 5 minutes remain in the current meeting

### Day view
- **Time-grid layout** — hour labels on the left, meetings positioned proportionally by start/end time (like Apple/Google Calendar)
- **Auto-fit** — the day scales to fill your screen without scrolling, showing only the hours that matter
- **Now line** — a red line marks the current time across the grid
- **Overlapping meetings** — displayed side-by-side in columns
- **All-day events** — shown as compact chips above the grid
- **Color fill** — events filled with your chosen urgency color or per-calendar colors

### General
- **Pull-to-refresh** — pull down to refresh events
- **Auto-refresh** — pulls new events every 5 minutes, resets at midnight
- **Screen wake lock** — keeps the display on while charging
- **PWA** — installs to your home screen, runs fullscreen with no browser chrome
- **Adjustable display size** — scale the UI up or down for your device
- **Color palettes** — choose your urgency color or use calendar colors
- **Demo mode** — works out of the box with sample data (no Google account needed)

## Quick Start

### Use the hosted version

Visit [https://howdymoto.github.io/NudgeCalendar/](https://howdymoto.github.io/NudgeCalendar/) and sign in with your Google account.

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
