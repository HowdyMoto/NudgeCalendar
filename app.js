// ── Configuration ───────────────────────────────────────
// Replace with your Google Cloud OAuth2 Client ID
// Instructions: https://console.cloud.google.com/apis/credentials
const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

// ── State ───────────────────────────────────────────────
let tokenClient;
let events = [];
let updateTimer;
let refreshTimer;

// ── Screens ─────────────────────────────────────────────
const authScreen = document.getElementById('auth-screen');
const calendarScreen = document.getElementById('calendar-screen');
const loadingScreen = document.getElementById('loading-screen');

function showScreen(screen) {
  [authScreen, calendarScreen, loadingScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

// ── Google API Init ─────────────────────────────────────
function gapiLoaded() {
  gapi.load('client', async () => {
    await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
    // Check for stored token
    const stored = localStorage.getItem('gapi_token');
    if (stored) {
      gapi.client.setToken(JSON.parse(stored));
      onAuthed();
    }
  });
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.error) return;
      localStorage.setItem('gapi_token', JSON.stringify(gapi.client.getToken()));
      onAuthed();
    },
  });
}

function handleAuth() {
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function onAuthed() {
  showScreen(loadingScreen);
  await fetchEvents();
  showScreen(calendarScreen);
  startTimers();
}

// ── Fetch Events ────────────────────────────────────────
async function fetchEvents() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  try {
    const response = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    events = (response.result.items || []).filter(e => e.status !== 'cancelled');
    renderEvents();
  } catch (err) {
    console.error('Failed to fetch events:', err);
    // Token might be expired
    if (err.status === 401) {
      localStorage.removeItem('gapi_token');
      showScreen(authScreen);
    }
  }
}

// ── Render ──────────────────────────────────────────────
function renderEvents() {
  const now = new Date();
  const list = document.getElementById('events-list');
  const empty = document.getElementById('empty-state');
  const header = document.getElementById('date-header');
  const nowTime = document.getElementById('now-marker-time');

  // Date header
  header.textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  // Current time
  nowTime.textContent = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit'
  });

  if (events.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  list.classList.remove('hidden');
  empty.classList.add('hidden');

  let nextUpId = null;
  let html = '';

  events.forEach((event, i) => {
    const isAllDay = !event.start.dateTime;
    const start = isAllDay ? null : new Date(event.start.dateTime);
    const end = isAllDay ? null : new Date(event.end.dateTime);

    // Determine state
    let state = '';
    let countdown = '';

    if (isAllDay) {
      state = 'all-day';
    } else if (now >= end) {
      state = 'past';
    } else if (now >= start && now < end) {
      state = 'current';
      if (!nextUpId) nextUpId = `ev-${i}`;
    } else {
      // Future event
      const minsUntil = (start - now) / 60000;
      if (!nextUpId && state !== 'past') nextUpId = `ev-${i}`;

      if (minsUntil <= 2) {
        state = 'upcoming-imminent';
        countdown = formatCountdown(start - now);
      } else if (minsUntil <= 5) {
        state = 'upcoming-near';
        countdown = formatCountdown(start - now);
      } else if (minsUntil <= 15) {
        state = 'upcoming-soon';
        countdown = formatCountdown(start - now);
      } else if (minsUntil <= 30) {
        state = 'upcoming-far';
        countdown = formatCountdown(start - now);
      }
    }

    // Time display
    let timeStr = '';
    if (isAllDay) {
      timeStr = 'All day';
    } else {
      const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      timeStr = `${fmt(start)} – ${fmt(end)}`;
    }

    const nextClass = (nextUpId === `ev-${i}`) ? ' next-up' : '';

    html += `
      <div id="ev-${i}" class="event-card ${state}${nextClass}">
        ${countdown ? `<span class="countdown">${countdown}</span>` : ''}
        <div class="event-time">${timeStr}</div>
        <div class="event-title">${escapeHtml(event.summary || '(No title)')}</div>
        ${event.location ? `<div class="event-location">${escapeHtml(event.location)}</div>` : ''}
      </div>
    `;
  });

  list.innerHTML = html;

  // Auto-scroll to next event
  if (nextUpId) {
    const el = document.getElementById(nextUpId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return `in ${hrs}h ${m}m`;
  }
  if (mins > 0) return `in ${mins}m`;
  return `in ${secs}s`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Timers ──────────────────────────────────────────────
function startTimers() {
  // Update display every 10 seconds
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(renderEvents, 10000);

  // Refresh from API every 5 minutes (demo reloads demo data)
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(DEMO_MODE ? loadDemoEvents : fetchEvents, 5 * 60 * 1000);

  // At midnight, refresh for new day
  scheduleMidnightRefresh();
}

function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const msUntilMidnight = midnight - now;
  setTimeout(() => {
    fetchEvents();
    scheduleMidnightRefresh();
  }, msUntilMidnight + 1000);
}

// ── Wake Lock (keep screen on) ──────────────────────────
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    // Wake lock not available or denied
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
    // Refresh when coming back to foreground
    if (gapi?.client?.getToken()) {
      fetchEvents();
    }
  }
});

// ── Service Worker ──────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ── Demo Mode ───────────────────────────────────────────
const DEMO_MODE = CLIENT_ID === 'YOUR_CLIENT_ID.apps.googleusercontent.com';

function loadDemoEvents() {
  const now = new Date();
  const today = (h, m) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const nowH = now.getHours();
  const nowM = now.getMinutes();

  events = [
    {
      summary: 'Team Standup',
      start: { dateTime: today(nowH - 2, 0) },
      end:   { dateTime: today(nowH - 2, 30) },
    },
    {
      summary: 'Sprint Review',
      start: { dateTime: today(nowH - 1, 0) },
      end:   { dateTime: today(nowH - 1, 45) },
    },
    {
      summary: 'Design Sync — Homepage Redesign',
      location: 'Zoom',
      start: { dateTime: today(nowH, nowM - 10) },
      end:   { dateTime: today(nowH, nowM + 20) },
    },
    {
      summary: '1:1 with Jordan',
      location: 'Conference Room B',
      start: { dateTime: today(nowH, nowM + 3) },
      end:   { dateTime: today(nowH, nowM + 33) },
    },
    {
      summary: 'API Review',
      start: { dateTime: today(nowH, nowM + 12) },
      end:   { dateTime: today(nowH, nowM + 42) },
    },
    {
      summary: 'Lunch',
      start: { dateTime: today(nowH, nowM + 45) },
      end:   { dateTime: today(nowH + 1, nowM + 45) },
    },
    {
      summary: 'Product Roadmap Planning',
      location: 'Main Conference Room',
      start: { dateTime: today(nowH + 2, 0) },
      end:   { dateTime: today(nowH + 3, 0) },
    },
    {
      summary: 'Company All-Hands',
      start: { date: now.toISOString().split('T')[0] },
      end:   { date: now.toISOString().split('T')[0] },
    },
  ];

  renderEvents();
}

// ── Bootstrap ───────────────────────────────────────────
if (DEMO_MODE) {
  // Skip Google auth, show demo data
  showScreen(calendarScreen);
  loadDemoEvents();
  startTimers();
} else {
  // Load Google API scripts
  (function loadGoogleAPIs() {
    const gapiScript = document.createElement('script');
    gapiScript.src = 'https://apis.google.com/js/api.js';
    gapiScript.onload = gapiLoaded;
    document.head.appendChild(gapiScript);

    const gisScript = document.createElement('script');
    gisScript.src = 'https://accounts.google.com/gsi/client';
    gisScript.onload = gisLoaded;
    document.head.appendChild(gisScript);
  })();
}

requestWakeLock();
