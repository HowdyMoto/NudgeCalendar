# Today — Desk Calendar

A minimal PWA that turns your phone into an always-on desk calendar. Connects to Google Calendar and shows today's events with live countdowns, color-coded by urgency.

## Features

- **Live countdowns** — events shift from calm to urgent as they approach
- **Auto-refresh** — pulls new events every 5 minutes, resets at midnight
- **Screen wake lock** — keeps the display on while charging
- **PWA** — installs to your home screen, runs fullscreen with no browser chrome
- **Demo mode** — works out of the box with sample data (no Google account needed)

## Quick Start

Serve the files locally to try it in demo mode:

```bash
npx serve -p 8080
```

Open `http://localhost:8080` — you'll see sample events immediately.

To connect your real Google Calendar, see [SETUP.md](SETUP.md).

## Desk Display Setup

1. Install the PWA on your iPhone (Safari → Share → Add to Home Screen)
2. Set up a Shortcuts automation to open the app when the charger connects
3. Place your phone on a MagSafe stand

Full instructions in [SETUP.md](SETUP.md).
