// ── Configuration ───────────────────────────────────────
// Replace with your Google Cloud OAuth2 Client ID
// Instructions: https://console.cloud.google.com/apis/credentials
const CLIENT_ID = '__GOOGLE_CLIENT_ID__';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/directory.readonly';
const DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
  'https://www.googleapis.com/discovery/v1/apis/people/v1/rest',
];

// ── State ───────────────────────────────────────────────
let tokenClient;
let events = [];
let updateTimer;
let refreshTimer;
let colorMode = localStorage.getItem('color_mode') || 'urgency';
let calendarColors = {};  // colorId → { background }
let calendarMeta = {};    // calendarId → { backgroundColor }
const photoCache = {};    // email → photo URL (or '' if none)
let lastStructureKey = '';

// Timeline scaling — computed dynamically to fit viewport
let PX_PER_MIN = 4;
const MIN_CARD_HEIGHT = 40;
let dayStartHour = 0;
let dayEndHour = 24;

function minsOf(a, b) { return (a - b) / 60000; }

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

  // ── Pull-to-refresh ──
  const indicator = document.getElementById('pull-indicator');
  let pullStartY = 0;
  let pulling = false;
  const PULL_THRESHOLD = 80;

  list.addEventListener('touchstart', (e) => {
    if (list.scrollTop <= 0) {
      pullStartY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  list.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy > 0 && list.scrollTop <= 0) {
      const progress = Math.min(dy / PULL_THRESHOLD, 1);
      indicator.style.transform = `translateY(${Math.min(dy * 0.5, 50)}px)`;
      indicator.style.opacity = progress;
      indicator.classList.toggle('ready', progress >= 1);
    } else {
      indicator.style.transform = '';
      indicator.style.opacity = 0;
    }
  }, { passive: true });

  list.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    const wasReady = indicator.classList.contains('ready');
    indicator.style.transform = '';
    indicator.style.opacity = 0;
    indicator.classList.remove('ready');
    if (wasReady) {
      indicator.classList.add('refreshing');
      indicator.style.opacity = 1;
      indicator.style.transform = 'translateY(40px)';
      const refresh = DEMO_MODE ? loadDemoEvents : fetchEvents;
      Promise.resolve(refresh()).finally(() => {
        indicator.classList.remove('refreshing');
        indicator.style.transform = '';
        indicator.style.opacity = 0;
      });
    }
  }, { passive: true });
});

// Milestone animation tracking
const firedMilestones = new Map();
const dismissedEvents = new Set();
const previousStates = new Set();
const ONE_SHOT_ANIM_CLASSES = ['throb-small', 'throb-medium', 'throb-large', 'meeting-done'];

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
      newMilestone = t;
    }
  }
  return newMilestone;
}

function dismissEvent(key, e) {
  dismissedEvents.add(key);
  const card = document.querySelector(`[data-dismiss="${CSS.escape(key)}"]`);
  if (card) {
    card.classList.remove('antsy');

    if (e) {
      const rect = card.getBoundingClientRect();
      const xPct = (e.clientX - rect.left) / rect.width * 2 - 1;
      const yPct = (e.clientY - rect.top) / rect.height * 2 - 1;
      card.style.setProperty('--tilt-x', `${yPct * -18}deg`);
      card.style.setProperty('--tilt-y', `${xPct * 18}deg`);
    }

    card.classList.add('tickled');
    const fallback = setTimeout(() => renderEvents(), 500);
    card.addEventListener('transitionend', () => {
      card.classList.remove('tickled');
      card.classList.add('tickled-out');
      card.addEventListener('transitionend', () => {
        clearTimeout(fallback);
        renderEvents();
      }, { once: true });
    }, { once: true });
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
    await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
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
  checkMorningBriefing();
}

// ── Fetch profile photos via People API ──────────────────
async function fetchPhotos(emails) {
  if (!gapi.client.people) return;
  const uncached = emails.filter(e => e && !(e in photoCache));
  if (uncached.length === 0) return;

  uncached.forEach(e => { photoCache[e] = ''; });

  await fetchPhotosFromContacts(uncached);

  let missing = uncached.filter(e => !photoCache[e]);
  if (missing.length) await fetchPhotosFromOtherContacts(missing);

  const found = uncached.filter(e => photoCache[e]);
  const notFound = uncached.filter(e => !photoCache[e]);
  if (found.length) console.log('[photos] found:', found);
  if (notFound.length) console.log('[photos] not found:', notFound);

  if (found.length) {
    lastStructureKey = '';
    renderEvents();
  }
}

async function fetchPhotosFromContacts(emails) {
  const fetches = emails.map(async email => {
    try {
      const resp = await gapi.client.people.people.searchContacts({
        query: email,
        readMask: 'photos',
        pageSize: 1,
      });
      const person = resp.result.results?.[0]?.person;
      const photo = person?.photos?.find(p => !p.default)?.url;
      if (photo) photoCache[email] = photo;
    } catch (e) {
      console.warn(`[photos] contacts lookup failed for ${email}:`, e);
    }
  });
  await Promise.all(fetches);
}

async function fetchPhotosFromOtherContacts(emails) {
  try {
    let pageToken = '';
    const emailSet = new Set(emails.map(e => e.toLowerCase()));
    do {
      const resp = await gapi.client.people.otherContacts.list({
        readMask: 'emailAddresses,photos',
        pageSize: 100,
        pageToken: pageToken || undefined,
      });
      const contacts = resp.result.otherContacts || [];
      for (const c of contacts) {
        const cEmails = (c.emailAddresses || []).map(e => e.value.toLowerCase());
        const match = cEmails.find(e => emailSet.has(e));
        if (match) {
          const photo = c.photos?.find(p => !p.default)?.url;
          if (photo) photoCache[match] = photo;
          emailSet.delete(match);
        }
      }
      pageToken = resp.result.nextPageToken || '';
    } while (pageToken && emailSet.size > 0);
  } catch (e) {
    console.warn('[photos] otherContacts lookup failed:', e);
  }
}

// ── Fetch Events (from all visible calendars) ───────────
async function fetchEvents() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  try {
    const calList = await gapi.client.calendar.calendarList.list();
    const calendars = (calList.result.items || []).filter(c => c.selected !== false);

    calendars.forEach(c => {
      calendarMeta[c.id] = { backgroundColor: c.backgroundColor };
    });

    const fetches = calendars.map(c =>
      gapi.client.calendar.events.list({
        calendarId: c.id,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      }).then(resp => {
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

    const emails = events.map(e => pickAvatarPerson(e).email).filter(Boolean);
    if (emails.length) fetchPhotos([...new Set(emails)]);
  } catch (err) {
    console.error('Failed to fetch events:', err);
    if (err.status === 401) {
      localStorage.removeItem('gapi_token');
      showScreen(authScreen);
    }
  }
}

// ── Render ──────────────────────────────────────────────

// Group overlapping timed events into clusters for side-by-side rendering.
function buildOverlapClusters(timedEvents) {
  // Use visual end (accounting for MIN_CARD_HEIGHT) so short events
  // that visually overlap get grouped into side-by-side columns.
  const minCardMs = (MIN_CARD_HEIGHT / PX_PER_MIN) * 60000;
  const clusters = [];
  let cluster = null;

  for (const ev of timedEvents) {
    const start = new Date(ev.start.dateTime).getTime();
    const end = new Date(ev.end.dateTime).getTime();
    const visualEnd = Math.max(end, start + minCardMs);

    if (!cluster || start >= cluster.visualEnd) {
      if (cluster) clusters.push(cluster);
      cluster = { events: [ev], clusterStart: start, clusterEnd: end, visualEnd };
    } else {
      cluster.events.push(ev);
      cluster.clusterEnd = Math.max(cluster.clusterEnd, end);
      cluster.visualEnd = Math.max(cluster.visualEnd, visualEnd);
    }
  }
  if (cluster) clusters.push(cluster);

  for (const c of clusters) {
    c.isOverlapping = c.events.length > 1;
  }
  return clusters;
}

// ── Color palettes ──────────────────────────────────────
const COLOR_PALETTES = [
  { name: 'Sky',      hex: '#4a9eff' },
  { name: 'Violet',   hex: '#8b6cf6' },
  { name: 'Teal',     hex: '#2bb5a0' },
  { name: 'Lime',     hex: '#6abf40' },
  { name: 'Gold',     hex: '#d4a017' },
  { name: 'Ember',    hex: '#e8722a' },
  { name: 'Sunset',   hex: '#e85d75' },
  { name: 'Rose',     hex: '#d46493' },
];

let urgencyR = 74, urgencyG = 158, urgencyB = 255;

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
  const saved = localStorage.getItem('urgency_color') || '#4a9eff';
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
    // Non-critical
  }
}

function getEventColor(event) {
  const colorId = event.colorId;
  if (colorId && calendarColors[colorId]) {
    return calendarColors[colorId].background;
  }
  const calId = event._calendarId;
  if (calId && calendarMeta[calId]) {
    return calendarMeta[calId].backgroundColor;
  }
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
function urgencyBgAlpha(minsUntil) {
  if (minsUntil <= 0) return 1;
  return Math.max(0, Math.exp(-0.02 * minsUntil));
}

function luminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function urgencyTextColor(bgAlpha, r, g, b) {
  const effR = Math.round(10 + (r - 10) * bgAlpha);
  const effG = Math.round(10 + (g - 10) * bgAlpha);
  const effB = Math.round(15 + (b - 15) * bgAlpha);
  const bgLum = luminance(effR, effG, effB);

  const whiteContrast = (1 + 0.05) / (bgLum + 0.05);
  const darkContrast = (bgLum + 0.05) / (0.01 + 0.05);

  return whiteContrast > darkContrast
    ? { title: '#ffffff', sub: 'rgba(255,255,255,0.75)' }
    : { title: '#1a1a2a', sub: '#2a2a3a' };
}

// ── Time grid rendering ─────────────────────────────────

function computeDayRange(timedEvents) {
  const now = new Date();
  let earliest = now.getHours();
  let latest = now.getHours() + 1;

  timedEvents.forEach(e => {
    const s = new Date(e.start.dateTime);
    const end = new Date(e.end.dateTime);
    earliest = Math.min(earliest, s.getHours());
    latest = Math.max(latest, end.getHours() + (end.getMinutes() > 0 ? 1 : 0));
  });

  // Pad by 1 hour on each side, clamp to 0–24
  dayStartHour = Math.max(0, earliest - 1);
  dayEndHour = Math.min(24, latest + 1);

  // Compute PX_PER_MIN to fit the available height
  const list = document.getElementById('events-list');
  const availableHeight = list.clientHeight;
  const totalMinutes = (dayEndHour - dayStartHour) * 60;
  PX_PER_MIN = Math.max(0.5, availableHeight / totalMinutes);
}

let lastGutterKey = '';

function renderHourGutter() {
  const gutter = document.getElementById('hour-gutter');
  const column = document.getElementById('event-column');
  const totalHeight = (dayEndHour - dayStartHour) * 60 * PX_PER_MIN;

  gutter.style.height = `${totalHeight}px`;
  column.style.height = `${totalHeight}px`;

  // Only rebuild when range or scale changes
  const gutterKey = `${dayStartHour}-${dayEndHour}-${PX_PER_MIN.toFixed(3)}`;
  if (gutterKey === lastGutterKey) return;
  lastGutterKey = gutterKey;

  gutter.innerHTML = '';
  column.querySelectorAll('.hour-line').forEach(el => el.remove());

  for (let h = dayStartHour; h <= dayEndHour; h++) {
    const topPx = (h - dayStartHour) * 60 * PX_PER_MIN;

    if (h > dayStartHour && h < dayEndHour) {
      const label = document.createElement('div');
      label.className = 'hour-label';
      label.style.top = `${topPx}px`;
      const displayHour = h % 12 || 12;
      const ampm = h < 12 ? 'AM' : 'PM';
      label.textContent = `${displayHour} ${ampm}`;
      gutter.appendChild(label);
    }

    if (h > dayStartHour && h < dayEndHour) {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = `${topPx}px`;
      column.appendChild(line);
    }
  }
}

function timeToY(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(dayStartHour, 0, 0, 0);
  return minsOf(date, startOfDay) * PX_PER_MIN;
}

function renderEvents() {
  const now = new Date();
  const list = document.getElementById('events-list');
  const column = document.getElementById('event-column');
  const empty = document.getElementById('empty-state');
  const header = document.getElementById('date-header');
  const allDayRow = document.getElementById('all-day-row');

  // Date header
  header.textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  if (events.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    allDayRow.classList.add('hidden');
    return;
  }

  list.classList.remove('hidden');
  empty.classList.add('hidden');

  // Compute visible range + scale to fit viewport, then render gutter
  const timedEvents = events.filter(e => e.start.dateTime);
  computeDayRange(timedEvents);
  renderHourGutter();

  // Update now-line position
  const nowLine = document.getElementById('now-line');
  const nowY = timeToY(now);
  nowLine.style.top = `${Math.round(nowY)}px`;
  nowLine.classList.remove('hidden');

  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // ── All-day events ──
  const allDayEvents = events.filter(e => !e.start.dateTime);
  if (allDayEvents.length) {
    allDayRow.innerHTML = allDayEvents.map(e =>
      `<div class="all-day-chip">${escapeHtml(e.summary || '(No title)')}</div>`
    ).join('');
    allDayRow.classList.remove('hidden');
  } else {
    allDayRow.classList.add('hidden');
  }

  // ── Timed events ──
  const clusters = buildOverlapClusters(timedEvents);

  // Build a structure key to detect when DOM needs rebuilding
  let structureKey = '';
  let bounceCount = 0;
  const cardDataList = [];

  // Assign columns for overlapping events
  clusters.forEach((cluster) => {
    const minCardMs = (MIN_CARD_HEIGHT / PX_PER_MIN) * 60000;

    if (cluster.isOverlapping) {
      // Greedy column packing
      const colVisualEnds = [];
      cluster.events.forEach(ev => {
        const evStart = new Date(ev.start.dateTime).getTime();
        const evEnd = new Date(ev.end.dateTime).getTime();
        const visualEnd = Math.max(evEnd, evStart + minCardMs);
        let col = colVisualEnds.findIndex(end => end <= evStart);
        if (col === -1) {
          col = colVisualEnds.length;
          colVisualEnds.push(0);
        }
        colVisualEnds[col] = visualEnd;
        cardDataList.push({ event: ev, column: col, totalColumns: 0, _cluster: cluster });
      });
      // Set totalColumns for this cluster
      const total = colVisualEnds.length;
      cardDataList.forEach(cd => {
        if (cd._cluster === cluster && cd.totalColumns === 0) cd.totalColumns = total;
      });
    } else {
      cardDataList.push({ event: cluster.events[0], column: 0, totalColumns: 1, _cluster: cluster });
    }
  });

  // Build HTML for each card
  const cardsHtml = cardDataList.map((cd, idx) => {
    const event = cd.event;
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    const key = eventKey(event);
    const minsUntil = (start - now) / 60000;
    const durationMins = minsOf(end, start);

    let state = '';
    let countdown = '';
    let animClass = '';
    let progress = 0;

    if (now >= end) {
      state = 'past';
      if (previousStates.has(key)) animClass = ' meeting-done';
    } else if (now >= start && now < end) {
      state = 'current';
      progress = (now - start) / (end - start);
      const minsLeft = (end - now) / 60000;
      if (!dismissedEvents.has(key)) {
        animClass = ' antsy';
      } else if (minsLeft <= 5) {
        animClass = ' wrapping-up';
      }
      countdown = `${Math.ceil(minsLeft)}m left`;
    } else {
      state = 'future';
      countdown = formatCountdown(start - now);
      const milestone = checkMilestone(key, minsUntil);
      if (minsUntil <= 3 && !dismissedEvents.has(key)) {
        animClass = ' antsy';
      } else if (milestone === 3) {
        animClass = ' throb-large';
      } else if (milestone === 15) {
        animClass = ' throb-medium';
      } else if (milestone === 30) {
        animClass = ' throb-small';
      }
    }

    // Positioning
    const topPx = timeToY(start);
    const heightPx = Math.max(MIN_CARD_HEIGHT, durationMins * PX_PER_MIN);
    const isCompact = heightPx <= 56;
    const gap = 4;
    const colWidthPct = (100 / cd.totalColumns).toFixed(2);
    const leftPct = (cd.column * 100 / cd.totalColumns).toFixed(2);
    const overlapClass = cd.totalColumns > 1 ? ' overlap-col' : '';

    let posStyle = `top:${Math.round(topPx)}px;height:${Math.round(heightPx)}px;`;
    if (cd.totalColumns > 1) {
      posStyle += `left:calc(${leftPct}% + ${gap / 2}px + 4px);width:calc(${colWidthPct}% - ${gap}px - 4px);right:auto;`;
    }

    // Color styling — fill card with calendar or urgency color
    let cardStyle = '';
    let timeColor = '';
    let titleColor = '';

    if (state === 'future' || state === 'current') {
      let r, g, b;
      if (colorMode === 'calendar') {
        const rgb = hexToRgb(getEventColor(event));
        r = rgb ? rgb.r : urgencyR;
        g = rgb ? rgb.g : urgencyG;
        b = rgb ? rgb.b : urgencyB;
      } else {
        r = urgencyR; g = urgencyG; b = urgencyB;
      }
      if (state === 'future') {
        const bgA = urgencyBgAlpha(minsUntil);
        const txt = urgencyTextColor(bgA, r, g, b);
        titleColor = ` style="color: ${txt.title}"`;
        timeColor = ` style="color: ${txt.sub}"`;
        cardStyle = `background: rgba(${r},${g},${b},${bgA.toFixed(3)});`;
      } else {
        // Current: solid color fill
        const txt = urgencyTextColor(0.55, r, g, b);
        titleColor = ` style="color: ${txt.title}"`;
        timeColor = ` style="color: ${txt.sub}"`;
        cardStyle = `background: rgba(${r},${g},${b},0.55);`;
      }
    }

    const progressStyle = state === 'current' ? `--progress: ${(progress * 100).toFixed(1)}%;` : '';
    const bounceDelay = animClass ? `animation-delay: ${(bounceCount++ * 0.4).toFixed(1)}s;` : '';
    const allStyles = posStyle + cardStyle + progressStyle + bounceDelay;
    const dismissAttr = animClass === ' antsy' ? ` data-dismiss="${escapeHtml(key)}"` : '';
    const compactClass = isCompact ? ' compact-card' : '';

    const avatarPerson = pickAvatarPerson(event);
    const avatarName = avatarPerson.displayName || avatarPerson.email || '';
    const avatarInitials = getInitials(avatarName);

    const startTimeStr = fmt(start);
    const fullTimeStr = `${fmt(start)} – ${fmt(end)}`;

    const details = [];
    details.push(`<div class="detail-row"><span class="detail-icon">🕐</span> ${fullTimeStr}</div>`);
    if (countdown && state === 'current') {
      details.push(`<div class="detail-row"><span class="detail-icon">⏳</span> ${escapeHtml(countdown)}</div>`);
    }
    if (event.location) {
      details.push(`<div class="detail-row"><span class="detail-icon">📍</span> ${escapeHtml(event.location)}</div>`);
    }
    const organizer = event.organizer || {};
    const organizerName = organizer.displayName || organizer.email || '';
    if (organizerName) {
      details.push(`<div class="detail-row"><span class="detail-icon">👤</span> Organized by ${escapeHtml(organizerName)}</div>`);
    }
    const attendeeCount = (event.attendees || []).filter(a => !a.self && !a.resource).length;
    if (attendeeCount > 0) {
      details.push(`<div class="detail-row"><span class="detail-icon">👥</span> ${attendeeCount} other${attendeeCount > 1 ? 's' : ''}</div>`);
    }
    if (event.description) {
      const desc = event.description.replace(/<[^>]+>/g, '').trim();
      if (desc) {
        const short = desc.length > 120 ? desc.slice(0, 120) + '…' : desc;
        details.push(`<div class="detail-row detail-desc">${escapeHtml(short)}</div>`);
      }
    }

    if (state === 'current') previousStates.add(key); else previousStates.delete(key);
    structureKey += `${idx}:${state}${animClass}|`;

    return `
      <div id="ev-${idx}" class="event-card ${state}${animClass}${compactClass}${overlapClass}" style="${allStyles}"${dismissAttr} data-expandable>
        <div class="card-summary">
          ${avatarName ? `<div class="organizer-avatar">
            ${photoCache[avatarPerson.email] ? `<img class="avatar-img" src="${photoCache[avatarPerson.email]}" alt="">` : ''}
            <span class="avatar-initials">${escapeHtml(avatarInitials)}</span>
          </div>` : ''}
          <div class="card-main">
            <div class="event-title"${titleColor}>${escapeHtml(event.summary || '(No title)')}</div>
            <div class="event-time"${timeColor}>${startTimeStr}${countdown ? ` · ${countdown}` : ''}</div>
          </div>
        </div>
        <div class="card-details">${details.join('')}</div>
      </div>
    `;
  }).join('');

  // Only rebuild DOM when structure changes
  if (structureKey !== lastStructureKey) {
    // Remove old event cards but keep hour-lines and now-line
    column.querySelectorAll('.event-card').forEach(el => el.remove());

    // Insert cards
    column.insertAdjacentHTML('beforeend', cardsHtml);
    lastStructureKey = structureKey;

    // Tap to dismiss continuous throb
    column.querySelectorAll('[data-dismiss]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (el.classList.contains('antsy')) {
          e.stopImmediatePropagation();
          dismissEvent(el.dataset.dismiss, e);
        }
      });
    });

    // Remove one-shot animation classes after they play
    const animSelector = ONE_SHOT_ANIM_CLASSES.map(c => '.' + c).join(', ');
    column.querySelectorAll(animSelector).forEach(el => {
      el.addEventListener('animationend', () => {
        el.classList.remove(...ONE_SHOT_ANIM_CLASSES);
      }, { once: true });
    });

    // Tap to expand/collapse card details
    column.querySelectorAll('[data-expandable]').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('expanded');
      });
    });

    // No scrolling needed — day fits viewport
  } else {
    // Patch dynamic values in-place
    column.querySelectorAll('.event-card').forEach(card => {
      const idx = card.id?.replace('ev-', '');
      // Update countdown text
      const timeEl = card.querySelector('.event-time');
      if (timeEl) {
        const match = cardsHtml.match(new RegExp(`id="ev-${idx}"[\\s\\S]*?class="event-time"[^>]*>([^<]+)<`));
        if (match) timeEl.textContent = match[1];
      }
      // Update progress
      if (card.classList.contains('current')) {
        const match = cardsHtml.match(new RegExp(`id="ev-${idx}"[^>]*--progress:\\s*([\\d.]+)%`));
        if (match) card.style.setProperty('--progress', match[1] + '%');
      }
    });

    // Update now-line position smoothly
    nowLine.style.top = `${Math.round(nowY)}px`;
  }
}

function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return `in ${hrs}h ${m}m`;
  }
  if (mins > 0) return `in ${mins}m`;
  const secs = Math.floor((ms % 60000) / 1000);
  return `in ${secs}s`;
}

// Pick the most relevant person to show as the card avatar.
function pickAvatarPerson(event) {
  const organizer = event.organizer || {};
  const attendees = event.attendees || [];
  const iAmOrganizer = organizer.self || attendees.some(a => a.self && a.organizer);

  if (!iAmOrganizer || attendees.length === 0) {
    return organizer;
  }

  const others = attendees.filter(a => !a.self && !a.resource);
  if (others.length === 0) return organizer;

  const statusScore = { accepted: 4, tentative: 3, needsAction: 2, declined: 0 };
  others.sort((a, b) => {
    const sa = statusScore[a.responseStatus] || 1;
    const sb = statusScore[b.responseStatus] || 1;
    if (sa !== sb) return sb - sa;
    if (a.displayName && !b.displayName) return -1;
    if (!a.displayName && b.displayName) return 1;
    return 0;
  });

  return others[0];
}

function getInitials(name) {
  if (!name) return '';
  if (name.includes('@')) name = name.split('@')[0].replace(/[._]/g, ' ');
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || '').slice(0, 2).toUpperCase();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Morning Briefing ────────────────────────────────────

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function checkMorningBriefing() {
  const ackDate = localStorage.getItem('briefing_ack_date');
  if (ackDate === todayString()) return;

  // Only show if there are future timed events today
  const now = new Date();
  const futureEvents = events.filter(e => e.start.dateTime && new Date(e.start.dateTime) > now);
  if (futureEvents.length === 0) return;

  showBriefing(futureEvents);
}

function showBriefing(futureEvents) {
  const overlay = document.getElementById('briefing-overlay');
  const cardsContainer = document.getElementById('briefing-cards');
  const dismissBtn = document.getElementById('briefing-dismiss');

  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  cardsContainer.innerHTML = futureEvents.map(event => {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    let r, g, b;
    if (colorMode === 'calendar') {
      const rgb = hexToRgb(getEventColor(event));
      r = rgb ? rgb.r : urgencyR;
      g = rgb ? rgb.g : urgencyG;
      b = rgb ? rgb.b : urgencyB;
    } else {
      r = urgencyR; g = urgencyG; b = urgencyB;
    }

    return `
      <div class="briefing-card" style="background: rgba(${r},${g},${b},0.35);">
        <div class="bc-time">${fmt(start)} – ${fmt(end)}</div>
        <div class="bc-title">${escapeHtml(event.summary || '(No title)')}</div>
      </div>
    `;
  }).join('');

  overlay.classList.remove('hidden');

  // Staggered cascade animation
  const cards = cardsContainer.querySelectorAll('.briefing-card');
  cards.forEach((card, i) => {
    setTimeout(() => {
      card.classList.add('cascade-in');
    }, i * 300);
  });

  // Show "Got it" button after all cards have landed
  const totalDelay = cards.length * 300 + 600;
  setTimeout(() => {
    dismissBtn.classList.remove('hidden');
    dismissBtn.classList.add('visible');
  }, totalDelay);

  // Dismiss handlers
  const dismiss = () => {
    localStorage.setItem('briefing_ack_date', todayString());
    overlay.classList.add('dismissing');
    overlay.addEventListener('animationend', () => {
      overlay.classList.add('hidden');
      overlay.classList.remove('dismissing');
      dismissBtn.classList.add('hidden');
      dismissBtn.classList.remove('visible');
    }, { once: true });
  };

  dismissBtn.addEventListener('click', dismiss, { once: true });

  // Also dismiss if user scrolls the calendar behind
  const list = document.getElementById('events-list');
  const scrollDismiss = () => {
    if (!overlay.classList.contains('hidden')) {
      dismiss();
      list.removeEventListener('scroll', scrollDismiss);
    }
  };
  list.addEventListener('scroll', scrollDismiss, { passive: true });
}

// ── Timers ──────────────────────────────────────────────
function startTimers() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(renderEvents, 10000);

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(DEMO_MODE ? loadDemoEvents : fetchEvents, 60 * 1000);

  scheduleMidnightRefresh();
}

function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const msUntilMidnight = midnight - now;
  setTimeout(() => {
    firedMilestones.clear();
    dismissedEvents.clear();
    previousStates.clear();
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
    if (gapi?.client?.getToken()) {
      fetchEvents().then(() => checkMorningBriefing());
    } else if (DEMO_MODE) {
      checkMorningBriefing();
    }
  }
});

// ── Resize → recalculate scale ──────────────────────────
window.addEventListener('resize', () => {
  lastStructureKey = '';
  lastGutterKey = '';
  if (events.length) renderEvents();
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

  calendarColors = {
    '1':  { background: '#7986cb' },
    '2':  { background: '#33b679' },
    '3':  { background: '#8e24aa' },
    '4':  { background: '#e67c73' },
    '5':  { background: '#f6bf26' },
    '6':  { background: '#f4511e' },
    '7':  { background: '#039be5' },
    '8':  { background: '#616161' },
    '9':  { background: '#3f51b5' },
    '10': { background: '#0b8043' },
    '11': { background: '#d50000' },
  };

  calendarMeta = {
    'work':     { backgroundColor: '#039be5' },
    'personal': { backgroundColor: '#7986cb' },
    'family':   { backgroundColor: '#33b679' },
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
      organizer: { displayName: 'You', email: 'me@example.com', self: true },
      attendees: [
        { displayName: 'You', email: 'me@example.com', self: true, responseStatus: 'accepted' },
        { displayName: 'Alex Chen', email: 'alex@example.com', responseStatus: 'accepted' },
        { displayName: 'Sam Rivera', email: 'sam@example.com', responseStatus: 'accepted' },
      ],
      start: { dateTime: today(nowH - 2, 0) },
      end:   { dateTime: today(nowH - 2, 30) },
    },
    {
      summary: 'Sprint Review',
      _calendarId: 'work',
      organizer: { displayName: 'Sam Rivera', email: 'sam@example.com' },
      attendees: [
        { displayName: 'You', email: 'me@example.com', self: true, responseStatus: 'accepted' },
        { displayName: 'Sam Rivera', email: 'sam@example.com', organizer: true, responseStatus: 'accepted' },
        { displayName: 'Alex Chen', email: 'alex@example.com', responseStatus: 'accepted' },
        { displayName: 'Morgan Lee', email: 'morgan@example.com', responseStatus: 'tentative' },
      ],
      description: 'Review sprint progress and demo completed stories.',
      start: { dateTime: today(nowH - 1, 0) },
      end:   { dateTime: today(nowH - 1, 45) },
    },
    {
      summary: 'Design Sync — Homepage Redesign',
      _calendarId: 'work',
      colorId: '3',
      location: 'Zoom',
      organizer: { displayName: 'Morgan Lee', email: 'morgan@example.com' },
      attendees: [
        { displayName: 'You', email: 'me@example.com', self: true, responseStatus: 'accepted' },
        { displayName: 'Morgan Lee', email: 'morgan@example.com', organizer: true, responseStatus: 'accepted' },
      ],
      description: 'Review latest mockups and discuss responsive layout approach.',
      start: { dateTime: today(nowH, nowM - 10) },
      end:   { dateTime: today(nowH, nowM + 20) },
    },
    {
      summary: '1:1 with Jordan',
      _calendarId: 'work',
      colorId: '4',
      location: 'Conference Room B',
      organizer: { displayName: 'You', email: 'me@example.com', self: true },
      attendees: [
        { displayName: 'You', email: 'me@example.com', self: true, organizer: true, responseStatus: 'accepted' },
        { displayName: 'Jordan Patel', email: 'jordan@example.com', responseStatus: 'accepted' },
      ],
      start: { dateTime: today(nowH, nowM - 5) },
      end:   { dateTime: today(nowH, nowM + 25) },
    },
    {
      summary: 'API Review',
      _calendarId: 'work',
      organizer: { displayName: 'Taylor Kim', email: 'taylor@example.com' },
      attendees: [
        { displayName: 'You', email: 'me@example.com', self: true, responseStatus: 'accepted' },
        { displayName: 'Taylor Kim', email: 'taylor@example.com', organizer: true, responseStatus: 'accepted' },
        { displayName: 'Alex Chen', email: 'alex@example.com', responseStatus: 'needsAction' },
      ],
      description: 'Walk through the new endpoints and discuss rate limiting strategy.',
      start: { dateTime: today(nowH, nowM + 12) },
      end:   { dateTime: today(nowH, nowM + 42) },
    },
    {
      summary: 'Lunch',
      _calendarId: 'personal',
      start: { dateTime: today(nowH + 1, 30) },
      end:   { dateTime: today(nowH + 2, 30) },
    },
    {
      summary: 'Product Roadmap Planning',
      _calendarId: 'family',
      location: 'Main Conference Room',
      organizer: { displayName: 'You', email: 'me@example.com', self: true },
      attendees: [
        { displayName: 'You', email: 'me@example.com', self: true, organizer: true, responseStatus: 'accepted' },
        { displayName: 'Casey Wright', email: 'casey@example.com', responseStatus: 'accepted' },
        { displayName: 'Jordan Patel', email: 'jordan@example.com', responseStatus: 'tentative' },
        { displayName: 'Morgan Lee', email: 'morgan@example.com', responseStatus: 'declined' },
        { displayName: 'Sam Rivera', email: 'sam@example.com', responseStatus: 'needsAction' },
      ],
      description: 'Q3 planning session. Bring your top 3 priorities.',
      start: { dateTime: today(nowH + 4, 0) },
      end:   { dateTime: today(nowH + 5, 0) },
    },
  ];

  lastStructureKey = '';
  renderEvents();
}

// ── Bootstrap ───────────────────────────────────────────
if (DEMO_MODE) {
  showScreen(calendarScreen);
  loadDemoEvents();
  startTimers();
  checkMorningBriefing();
} else {
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
