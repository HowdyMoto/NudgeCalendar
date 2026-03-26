# Today – Desk Calendar Setup

## 1. Create Google Cloud OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Calendar API**:
   - APIs & Services → Library → search "Google Calendar API" → Enable
4. Create OAuth credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized JavaScript origins: add your hosting URL (e.g. `https://yourdomain.com` or `http://localhost:8080` for testing)
   - Authorized redirect URIs: same as above
5. Copy the **Client ID**

## 2. Configure the App

Open `app.js` and replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID.

## 3. Host the App

This must be served over HTTPS (required for Google OAuth and PWA).

**For local testing:**
```bash
# Python
python -m http.server 8080

# Node
npx serve -p 8080
```

**For production**, deploy to any static host:
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

## 4. Generate App Icons

1. Open `generate-icons.html` in a browser
2. Right-click each canvas → Save Image As:
   - 192×192 → `icon-192.png`
   - 512×512 → `icon-512.png`
3. You can delete `generate-icons.html` after

## 5. Install on iPhone

1. Open the hosted URL in Safari
2. Tap the Share button (box with arrow)
3. Tap **"Add to Home Screen"**
4. The app will now launch fullscreen (no browser chrome)

## 6. MagSafe Always-On Display

iOS doesn't have a native "launch app when charging" feature, but you can use **Shortcuts automation**:

1. Open the **Shortcuts** app
2. Go to **Automation** tab
3. Tap **+** → **Create Personal Automation**
4. Select **Charger** → **Is Connected** → Next
5. Add action: **Open App** → choose Safari (or the "Today" home screen shortcut)
6. Turn off "Ask Before Running"
7. Done

Now whenever your iPhone connects to the MagSafe charger, it will automatically open the calendar app.

**Tip:** Also set Auto-Lock to **Never** (Settings → Display & Brightness → Auto-Lock) while using as a desk display — or at least set it to a long duration.
