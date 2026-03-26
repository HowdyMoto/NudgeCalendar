// ── Configuration ───────────────────────────────────────
// Replace with your Google Cloud OAuth2 Client ID
// Instructions: https://console.cloud.google.com/apis/credentials
const CLIENT_ID = '__GOOGLE_CLIENT_ID__';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

// ── State ───────────────────────────────────────────────
let tokenClient;
let events = [];
let updateTimer;
let refreshTimer;
let colorMode = localStorage.getItem('color_mode') || 'urgency';
let calendarColors = {};  // colorId → { background }
let calendarMeta = {};    // calendarId → { backgroundColor }
let lastStructureKey = '';

// Scroll tracking — let user browse freely, rubber-band back after 30s
let userScrolledRecently = false;
let scrollTimeout = null;
const SCROLL_RETURN_DELAY = 30000;

document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('events-list');
  if (list) {
    list.addEventListener('scroll', () => {
      userScrolledRecently = true;
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        userScrolledRecently = false;
      }, SCROLL_RETURN_DELAY);
    }, { passive: true });
  }
});

// Milestone animation tracking
// Keys are event IDs (summary + start time), values are Sets of fired thresholds
const firedMilestones = new Map();
const dismissedEvents = new Set();

function eventKey(event) {
  const t = event.start.dateTime || event.start.date;
  return `${event.summary || ''}|${t}`;
}

function checkMilestone(key, minsUntil) {
  if (!firedMilestones.has(key)) firedMilestones.set(key, new Set());
  const fired = firedMilestones.get(key);
  const thresholds = [30, 15, 3];
  let newMilestone = null;
  for (const t of thresholds) {
    if (minsUntil <= t && !fired.has(t)) {
      fired.add(t);
      newMilestone = t; // return the one just crossed
    }
  }
  return newMilestone;
}

function dismissEvent(key) {
  dismissedEvents.add(key);
  const card = document.querySelector(`[data-dismiss="${CSS.escape(key)}"]`);
  if (card) {
    card.classList.remove('antsy');
    // Force reflow so the new animation starts fresh
    void card.offsetWidth;
    card.classList.add('tickled');
    card.addEventListener('animationend', () => renderEvents(), { once: true });
  } else {
    renderEvents();
  }
}

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
  await Promise.all([fetchEvents(), fetchCalendarColors()]);
  showScreen(calendarScreen);
  startTimers();
}

// ── Fetch Events (from all visible calendars) ───────────
async function fetchEvents() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  try {
    // Get all calendars the user can see
    const calList = await gapi.client.calendar.calendarList.list();
    const calendars = (calList.result.items || []).filter(c => c.selected !== false);

    // Store each calendar's color
    calendars.forEach(c => {
      calendarMeta[c.id] = { backgroundColor: c.backgroundColor };
    });

    // Fetch events from all calendars in parallel
    const fetches = calendars.map(c =>
      gapi.client.calendar.events.list({
        calendarId: c.id,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      }).then(resp => {
        // Tag each event with its source calendar ID
        return (resp.result.items || []).map(ev => ({
          ...ev,
          _calendarId: c.id,
        }));
      }).catch(() => [])
    );

    const results = await Promise.all(fetches);
    const seen = new Set();
    events = results.flat()
      .filter(e => {
        if (e.status === 'cancelled') return false;
        // Deduplicate by iCalUID (same event across calendars shares this)
        const uid = e.iCalUID;
        if (uid && seen.has(uid)) return false;
        if (uid) seen.add(uid);
        return true;
      })
      .sort((a, b) => {
        const aTime = a.start.dateTime || a.start.date || '';
        const bTime = b.start.dateTime || b.start.date || '';
        return aTime.localeCompare(bTime);
      });

    lastStructureKey = '';
    renderEvents();
  } catch (err) {
    console.error('Failed to fetch events:', err);
    if (err.status === 401) {
      localStorage.removeItem('gapi_token');
      showScreen(authScreen);
    }
  }
}

// ── Render ──────────────────────────────────────────────

// Calculate top margin to represent the time gap before an event.
// Uses sqrt scaling so short gaps are visible but long gaps don't blow out.
// Cap at 140px so a full day still fits on screen.
function gapMargin(gapMinutes) {
  if (gapMinutes <= 0) return 0;
  return Math.min(140, Math.sqrt(gapMinutes) * 9);
}

// ── Color palettes ──────────────────────────────────────
const COLOR_PALETTES = [
  { name: 'Ember',    hex: '#e8722a' },
  { name: 'Sunset',   hex: '#e85d75' },
  { name: 'Gold',     hex: '#d4a017' },
  { name: 'Lime',     hex: '#6abf40' },
  { name: 'Teal',     hex: '#2bb5a0' },
  { name: 'Sky',      hex: '#4a9eff' },
  { name: 'Violet',   hex: '#8b6cf6' },
  { name: 'Rose',     hex: '#d46493' },
];

let urgencyR = 232, urgencyG = 114, urgencyB = 42;

function setUrgencyColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  urgencyR = rgb.r;
  urgencyG = rgb.g;
  urgencyB = rgb.b;
  document.documentElement.style.setProperty('--urgency', hex);
  document.documentElement.style.setProperty('--ur', urgencyR);
  document.documentElement.style.setProperty('--ug', urgencyG);
  document.documentElement.style.setProperty('--ub', urgencyB);
  localStorage.setItem('urgency_color', hex);
  document.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('selected', el.dataset.hex === hex);
  });
  lastStructureKey = '';
  if (events.length) renderEvents();
}

function initColorPicker() {
  const container = document.getElementById('color-options');
  COLOR_PALETTES.forEach(p => {
    const el = document.createElement('div');
    el.className = 'color-swatch';
    el.style.background = p.hex;
    el.dataset.hex = p.hex;
    el.title = p.name;
    el.onclick = () => setUrgencyColor(p.hex);
    container.appendChild(el);
  });
  // Restore saved color
  const saved = localStorage.getItem('urgency_color') || '#e8722a';
  setUrgencyColor(saved);
}

function setColorMode(mode) {
  colorMode = mode;
  localStorage.setItem('color_mode', mode);
  document.querySelectorAll('#color-mode-toggle .toggle-btn').forEach(el => {
    el.classList.toggle('selected', el.dataset.mode === mode);
  });
  document.getElementById('urgency-section').classList.toggle('hidden', mode !== 'urgency');
  lastStructureKey = '';
  if (events.length) renderEvents();
}

function initColorMode() {
  const saved = localStorage.getItem('color_mode') || 'urgency';
  setColorMode(saved);
}

async function fetchCalendarColors() {
  try {
    const resp = await gapi.client.calendar.colors.get();
    calendarColors = resp.result.event || {};
  } catch (e) {
    // Non-critical, fall back to urgency colors
  }
}

function getEventColor(event) {
  // 1. Event-level color override (user changed this specific event's color)
  const colorId = event.colorId;
  if (colorId && calendarColors[colorId]) {
    return calendarColors[colorId].background;
  }
  // 2. Calendar-level color (the calendar this event belongs to)
  const calId = event._calendarId;
  if (calId && calendarMeta[calId]) {
    return calendarMeta[calId].backgroundColor;
  }
  // 3. Fallback
  return '#039be5';
}

function hexToRgb(hex) {
  const m = hex && hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function setScale(value) {
  const pct = parseInt(value, 10);
  const screen = document.getElementById('calendar-screen');
  screen.style.fontSize = `${pct}%`;
  const radius = Math.max(2, Math.round(14 * Math.pow(pct / 100, 3)));
  document.documentElement.style.setProperty('--radius', `${radius}px`);
  localStorage.setItem('display_scale', pct);
}

function initScale() {
  const saved = localStorage.getItem('display_scale') || '100';
  document.getElementById('scale-slider').value = saved;
  setScale(saved);
}

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  panel.classList.toggle('hidden');
}

// Close settings when tapping outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('settings-panel');
  const btn = document.getElementById('settings-btn');
  if (!panel.classList.contains('hidden') &&
      !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initColorPicker();
  initColorMode();
  initScale();
});

// Background opacity: 1.0 at 0 min, fades to 0 at ~120 min
// Decay rate controls how fast it fades. At 0.02, it's ~0.3 at 60 min, ~0.09 at 120 min.
function urgencyBgAlpha(minsUntil) {
  if (minsUntil <= 0) return 1;
  return Math.max(0, Math.exp(-0.02 * minsUntil));
}

// Relative luminance of an sRGB color (0–1)
function luminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Compute effective text colors by blending the card bg over the page bg (#0a0a0f)
// and picking white or dark text based on contrast ratio.
function urgencyTextColor(bgAlpha, r, g, b) {
  // Blend card color over page background (#0a0a0f ≈ 10,10,15)
  const effR = Math.round(10 + (r - 10) * bgAlpha);
  const effG = Math.round(10 + (g - 10) * bgAlpha);
  const effB = Math.round(15 + (b - 15) * bgAlpha);
  const bgLum = luminance(effR, effG, effB);

  // Contrast ratio with white (lum=1) vs dark (#1a1a2a, lum≈0.01)
  const whiteContrast = (1 + 0.05) / (bgLum + 0.05);
  const darkContrast = (bgLum + 0.05) / (0.01 + 0.05);

  // Prefer dark text unless white has clearly better contrast
  return whiteContrast > darkContrast * 1.6
    ? { title: '#ffffff', sub: '#dddddd' }
    : { title: '#1a1a2a', sub: '#2a2a3a' };
}

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

  // Track the "cursor" — what time the previous event ended (or now, whichever is later)
  let cursor = now;
  let nextUpId = null;
  let html = '';
  let structureKey = '';

  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // ── Separate all-day events ──
  let allDayHtml = '';
  events.forEach((event, i) => {
    if (!event.start.dateTime) {
      allDayHtml += `<div class="all-day-chip">${escapeHtml(event.summary || '(No title)')}</div>`;
    }
  });
  if (allDayHtml) {
    html += `<div class="all-day-row">${allDayHtml}</div>`;
  }

  // ── Timed events ──
  let currentCount = 0;

  events.forEach((event, i) => {
    const isAllDay = !event.start.dateTime;
    if (isAllDay) return;

    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    // Determine state
    let state = '';
    let countdown = '';
    let animClass = '';
    let minsUntil = (start - now) / 60000;
    const key = eventKey(event);

    let progress = 0;

    if (now >= end) {
      state = 'past';
    } else if (now >= start && now < end) {
      state = 'current';
      currentCount++;
      if (!nextUpId) nextUpId = `ev-${i}`;
      progress = (now - start) / (end - start);
      const minsLeft = (end - now) / 60000;
      countdown = `${Math.ceil(minsLeft)}m left`;
      // Show overlap connector between concurrent meetings
      if (currentCount > 1) {
        html += `<div class="overlap-connector"><span class="overlap-label">overlapping</span></div>`;
      }
    } else {
      // Future event
      if (!nextUpId) nextUpId = `ev-${i}`;
      state = 'future';
      countdown = formatCountdown(start - now);

      // Check for milestone one-shot animations
      const milestone = checkMilestone(key, minsUntil);

      if (minsUntil <= 3 && !dismissedEvents.has(key)) {
        // Continuous throb until tapped
        animClass = ' antsy';
      } else if (milestone === 3) {
        animClass = ' throb-large';
      } else if (milestone === 15) {
        animClass = ' throb-medium';
      } else if (milestone === 30) {
        animClass = ' throb-small';
      }
    }

    // ── Timeline connector: line + free time label between events ──
    let spacingPx = 0;
    if (state !== 'past' && start > cursor) {
      const gapMins = (start - cursor) / 60000;
      spacingPx = gapMargin(gapMins);
      if (gapMins >= 1) {
        // Show now-line if gap starts near current time (within 1 min)
        const gapStartsNow = Math.abs(cursor - now) < 60000;
        const gapProgress = gapStartsNow ? Math.min(1, (now - cursor) / (start - cursor)) : -1;
        const nowLineHtml = gapStartsNow ? `<div class="now-line" style="top:${(gapProgress * 100).toFixed(1)}%"></div>` : '';
        const label = formatFreeTime(gapMins);
        html += `
          <div class="timeline-connector" style="height: ${Math.round(spacingPx)}px;">
            <div class="timeline-line"></div>
            ${nowLineHtml}
            <span class="timeline-label">${label}</span>
          </div>
        `;
        spacingPx = 0; // connector handles the spacing now
      }
    }

    // Advance cursor
    const effective = end > cursor ? end : cursor;
    cursor = effective;

    // ── Card color styling ──
    let cardStyle = '';
    let timeColor = '';
    let titleColor = '';
    let locColor = '';

    if (state === 'future') {
      let r, g, b;

      if (colorMode === 'calendar') {
        const rgb = hexToRgb(getEventColor(event));
        r = rgb ? rgb.r : urgencyR;
        g = rgb ? rgb.g : urgencyG;
        b = rgb ? rgb.b : urgencyB;
      } else {
        r = urgencyR; g = urgencyG; b = urgencyB;
      }

      const bgA = urgencyBgAlpha(minsUntil);
      const txt = urgencyTextColor(bgA, r, g, b);
      titleColor = ` style="color: ${txt.title}"`;
      timeColor = ` style="color: ${txt.sub}"`;
      locColor = ` style="color: ${txt.sub}"`;
      cardStyle = `background: rgba(${r},${g},${b},${bgA.toFixed(3)});`;
    }

    const timeStr = `${fmt(start)} – ${fmt(end)}`;

    const nextClass = (nextUpId === `ev-${i}`) ? ' next-up' : '';
    const spacingStyle = spacingPx > 0 ? `margin-top: ${Math.round(spacingPx)}px;` : '';
    const allStyles = spacingStyle + cardStyle;
    const inlineStyle = allStyles ? ` style="${allStyles}"` : '';
    const dismissAttr = animClass === ' antsy' ? ` data-dismiss="${key}"` : '';

    const progressBar = state === 'current'
      ? `<div class="current-progress"><div class="current-progress-fill" style="width:${(progress * 100).toFixed(1)}%"></div></div>`
      : '';

    // Track structure (state + animations) separately from dynamic values
    structureKey += `${i}:${state}${animClass}|`;

    html += `
      <div id="ev-${i}" class="event-card ${state}${nextClass}${animClass}"${inlineStyle}${dismissAttr}>
        ${countdown ? `<span class="countdown"${timeColor}>${countdown}</span>` : ''}
        <div class="event-time"${timeColor}>${timeStr}</div>
        <div class="event-title"${titleColor}>${escapeHtml(event.summary || '(No title)')}</div>
        ${event.location ? `<div class="event-location"${locColor}>${escapeHtml(event.location)}</div>` : ''}
        ${progressBar}
      </div>
    `;
  });

  // Only rebuild DOM when structure changes (avoids restarting animations)
  if (structureKey !== lastStructureKey) {
    list.innerHTML = html;
    lastStructureKey = structureKey;

    // Tap to dismiss continuous throb
    list.querySelectorAll('[data-dismiss]').forEach(el => {
      el.addEventListener('click', () => dismissEvent(el.dataset.dismiss));
    });

    // Remove one-shot animation classes after they play
    list.querySelectorAll('.throb-small, .throb-medium, .throb-large').forEach(el => {
      el.addEventListener('animationend', () => {
        el.classList.remove('throb-small', 'throb-medium', 'throb-large');
      }, { once: true });
    });
  } else {
    // Patch only dynamic values in-place
    list.querySelectorAll('.countdown').forEach(el => {
      const card = el.closest('.event-card');
      const idx = card?.id?.replace('ev-', '');
      if (idx != null) {
        const newCard = html.match(new RegExp(`id="ev-${idx}"[^>]*>[\\s\\S]*?<span class="countdown"[^>]*>([^<]+)</span>`));
        if (newCard) el.textContent = newCard[1];
      }
    });
    const fill = list.querySelector('.current-progress-fill');
    if (fill) {
      const match = html.match(/current-progress-fill" style="width:([\d.]+)%/);
      if (match) fill.style.width = match[1] + '%';
    }
    // Update now-line position in gap
    const nowLine = list.querySelector('.now-line');
    if (nowLine) {
      const match = html.match(/now-line" style="top:([\d.]+)%/);
      if (match) nowLine.style.top = match[1] + '%';
    }
  }

  // Auto-scroll to next event (respects user scroll — waits before snapping back)
  if (nextUpId && !userScrolledRecently) {
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

function formatFreeTime(mins) {
  if (mins < 60) return `${Math.round(mins)}m free`;
  const hrs = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (m === 0) return `${hrs}h free`;
  return `${hrs}h ${m}m free`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Timers ──────────────────────────────────────────────
function startTimers() {
  // Update display every 10 seconds
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(renderEvents, 10000);

  // Refresh from API every 5 minutes (demo reloads demo data)
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(DEMO_MODE ? loadDemoEvents : fetchEvents, 60 * 1000);

  // At midnight, refresh for new day
  scheduleMidnightRefresh();
}

function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const msUntilMidnight = midnight - now;
  setTimeout(() => {
    firedMilestones.clear();
    dismissedEvents.clear();
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
const DEMO_MODE = !CLIENT_ID || CLIENT_ID.startsWith('__');

function loadDemoEvents() {
  const now = new Date();
  const today = (h, m) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const nowH = now.getHours();
  const nowM = now.getMinutes();

  // Demo event-level colors (Google's colorId mapping)
  calendarColors = {
    '1':  { background: '#7986cb' }, // Lavender
    '2':  { background: '#33b679' }, // Sage
    '3':  { background: '#8e24aa' }, // Grape
    '4':  { background: '#e67c73' }, // Flamingo
    '5':  { background: '#f6bf26' }, // Banana
    '6':  { background: '#f4511e' }, // Tangerine
    '7':  { background: '#039be5' }, // Peacock
    '8':  { background: '#616161' }, // Graphite
    '9':  { background: '#3f51b5' }, // Blueberry
    '10': { background: '#0b8043' }, // Basil
    '11': { background: '#d50000' }, // Tomato
  };

  // Demo calendar-level colors (simulates different calendars)
  calendarMeta = {
    'work':     { backgroundColor: '#039be5' }, // Peacock blue
    'personal': { backgroundColor: '#7986cb' }, // Lavender
    'family':   { backgroundColor: '#33b679' }, // Sage green
  };

  events = [
    {
      summary: 'Company All-Hands',
      _calendarId: 'work',
      start: { date: now.toISOString().split('T')[0] },
      end:   { date: now.toISOString().split('T')[0] },
    },
    {
      summary: 'Team Standup',
      _calendarId: 'work',
      start: { dateTime: today(nowH - 2, 0) },
      end:   { dateTime: today(nowH - 2, 30) },
    },
    {
      summary: 'Sprint Review',
      _calendarId: 'work',
      start: { dateTime: today(nowH - 1, 0) },
      end:   { dateTime: today(nowH - 1, 45) },
    },
    {
      summary: 'Design Sync — Homepage Redesign',
      _calendarId: 'work',
      colorId: '3', // event-level override: Grape
      location: 'Zoom',
      start: { dateTime: today(nowH, nowM - 10) },
      end:   { dateTime: today(nowH, nowM + 20) },
    },
    {
      summary: '1:1 with Jordan',
      _calendarId: 'work',
      colorId: '4', // event-level override: Flamingo
      location: 'Conference Room B',
      start: { dateTime: today(nowH, nowM - 5) },
      end:   { dateTime: today(nowH, nowM + 25) },
    },
    {
      summary: 'API Review',
      _calendarId: 'work', // inherits Work calendar blue
      start: { dateTime: today(nowH, nowM + 12) },
      end:   { dateTime: today(nowH, nowM + 42) },
    },
    {
      summary: 'Lunch',
      _calendarId: 'personal', // inherits Personal calendar lavender
      start: { dateTime: today(nowH + 1, 30) },
      end:   { dateTime: today(nowH + 2, 30) },
    },
    {
      summary: 'Product Roadmap Planning',
      _calendarId: 'family', // inherits Family calendar green
      location: 'Main Conference Room',
      start: { dateTime: today(nowH + 4, 0) },
      end:   { dateTime: today(nowH + 5, 0) },
    },
  ];

  lastStructureKey = '';
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
