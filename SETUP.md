# Today – Desk Calendar Setup

## 1. Create Google Cloud OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Calendar API**:
   - APIs & Services → Library → search "Google Calendar API" → Enable
4. Create OAuth credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized JavaScript origins: add your hosting URL (e.g. `https://yourdomain.github.io` or `http://localhost:8080` for testing)
   - Authorized redirect URIs: same as above
5. Copy the **Client ID**

## 2. Configure the App

Create a `.env` file in the project root:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

The build step injects this into the app automatically.

## 3. Build & Run

```bash
npm install
npm run dev    # Dev server with auto-rebuild at http://localhost:8080
npm run build  # Production build to dist/
```

## 4. Deploy

The app deploys automatically to GitHub Pages via GitHub Actions on push to `master`.

To set up deployment for your own fork:

1. Go to your repo → Settings → Secrets and variables → Actions
2. Add a repository secret: `GOOGLE_CLIENT_ID` with your client ID
3. Go to Settings → Pages → Source: **GitHub Actions**
4. Push to `master` — the Action builds and deploys to `https://<username>.github.io/Calendar/`

You can also deploy `dist/` to any static host (Netlify, Vercel, Cloudflare Pages). HTTPS is required for Google OAuth and PWA features.

## 5. Install on Your Phone

### iPhone
1. Open the hosted URL in Safari
2. Tap the Share button → **"Add to Home Screen"**
3. The app launches fullscreen with no browser chrome

### Android
1. Open the hosted URL in Chrome
2. Tap the menu → **"Add to Home Screen"** (or accept the install prompt)

## 6. Always-On Desk Display

### Android
Enable **Developer Options** → **Stay awake** — the screen stays on while charging. Place your phone on a stand or charger.

### iPhone
iOS doesn't have a native "stay awake while charging" option, but you can:

1. Set Auto-Lock to **Never** (Settings → Display & Brightness → Auto-Lock) while using as a desk display
2. Optionally, use **Shortcuts automation** to auto-launch the app when charging:
   - Open **Shortcuts** → **Automation** tab → **+**
   - Select **Charger** → **Is Connected** → Next
   - Add action: **Open App** → choose the "Today" home screen app
   - Turn off "Ask Before Running"

Now whenever your iPhone connects to a charger, it automatically opens the calendar.
