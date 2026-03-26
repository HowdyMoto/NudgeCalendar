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
    await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
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

// ── Fetch profile photos via People API ──────────────────
async function fetchPhotos(emails) {
  if (!gapi.client.people) return;
  const uncached = emails.filter(e => e && !(e in photoCache));
  if (uncached.length === 0) return;

  // Mark as pending so we don't re-fetch
  uncached.forEach(e => { photoCache[e] = ''; });

  // Try multiple sources in order: contacts, other contacts, then directory
  await fetchPhotosFromContacts(uncached);

  let missing = uncached.filter(e => !photoCache[e]);
  if (missing.length) await fetchPhotosFromOtherContacts(missing);

  missing = uncached.filter(e => !photoCache[e]);
  if (missing.length) await fetchPhotosFromDirectory(missing);

  // Re-render if any photos were found
  if (uncached.some(e => photoCache[e])) {
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
    } catch (e) {}
  });
  await Promise.all(fetches);
}

async function fetchPhotosFromOtherContacts(emails) {
  // "Other contacts" are people you've emailed/met with but haven't saved.
  // The API doesn't support search, so we list and match by email.
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
      // Stop if we found everyone or there are no more pages
    } while (pageToken && emailSet.size > 0);
  } catch (e) {
    // contacts.other.readonly not granted or API error
  }
}

async function fetchPhotosFromDirectory(emails) {
  const fetches = emails.map(async email => {
    try {
      const resp = await gapi.client.people.people.searchDirectoryPeople({
        query: email,
        readMask: 'photos',
        sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
        pageSize: 1,
      });
      const person = resp.result.people?.[0];
      const photo = person?.photos?.find(p => !p.default)?.url;
      if (photo) photoCache[email] = photo;
    } catch (e) {}
  });
  await Promise.all(fetches);
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

    // Kick off background photo fetch for all avatar people
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

// Calculate top margin to represent the time gap before an event.
// Uses sqrt scaling so short gaps are visible but long gaps don't blow out.
// Cap at 140px so a full day still fits on screen.
function gapMargin(gapMinutes) {
  if (gapMinutes <= 0) return 0;
  return Math.min(140, Math.sqrt(gapMinutes) * 9);
}

// Group overlapping timed events into clusters for side-by-side rendering.
// Returns array of { events: [...], isOverlapping, clusterStart, clusterEnd }.
function buildOverlapClusters(timedEvents) {
  const clusters = [];
  let cluster = null;

  for (const ev of timedEvents) {
    const start = new Date(ev.start.dateTime).getTime();
    const end = new Date(ev.end.dateTime).getTime();

    if (!cluster || start >= cluster.clusterEnd) {
      // Finalize previous cluster
      if (cluster) clusters.push(cluster);
      cluster = { events: [ev], clusterStart: start, clusterEnd: end };
    } else {
      // Overlaps with current cluster
      cluster.events.push(ev);
      cluster.clusterEnd = Math.max(cluster.clusterEnd, end);
    }
  }
  if (cluster) clusters.push(cluster);

  // Mark clusters with 2+ events as overlapping
  for (const c of clusters) {
    c.isOverlapping = c.events.length > 1;
  }
  return clusters;
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

  // Pick whichever text color gives better contrast
  return whiteContrast > darkContrast
    ? { title: '#ffffff', sub: 'rgba(255,255,255,0.75)' }
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
  const timedEvents = events.filter(e => e.start.dateTime);
  const clusters = buildOverlapClusters(timedEvents);

  // Map each timed event back to its original index in `events` for stable IDs
  const eventIndex = new Map();
  events.forEach((e, i) => { if (e.start.dateTime) eventIndex.set(e, i); });

  function renderCard(event, opts) {
    const i = eventIndex.get(event);
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

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
      if (!nextUpId) nextUpId = `ev-${i}`;
      progress = (now - start) / (end - start);
      const minsLeft = (end - now) / 60000;
      if (minsLeft <= 5) animClass = ' wrapping-up';
      countdown = `${Math.ceil(minsLeft)}m left`;
    } else {
      if (!nextUpId) nextUpId = `ev-${i}`;
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

    // Card color styling
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

    const startTimeStr = fmt(start);
    const fullTimeStr = `${fmt(start)} – ${fmt(end)}`;
    const nextClass = (nextUpId === `ev-${i}`) ? ' next-up' : '';
    // In overlap groups, offset cards that start later than the cluster's first event
    const offsetPx = opts.grouped && opts.clusterStart
      ? gapMargin((start - opts.clusterStart) / 60000)
      : 0;
    const spacingStyle = (opts.spacingPx || 0) > 0
      ? `margin-top: ${Math.round(opts.spacingPx)}px;`
      : (offsetPx > 0 ? `margin-top: ${Math.round(offsetPx)}px;` : '');
    const progressStyle = state === 'current' ? `--progress: ${(progress * 100).toFixed(1)}%;` : '';
    const allStyles = spacingStyle + cardStyle + progressStyle;
    const inlineStyle = allStyles ? ` style="${allStyles}"` : '';
    const dismissAttr = animClass === ' antsy' ? ` data-dismiss="${key}"` : '';

    const avatarPerson = pickAvatarPerson(event);
    const avatarName = avatarPerson.displayName || avatarPerson.email || '';
    const avatarInitials = getInitials(avatarName);

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

    structureKey += `${i}:${state}${animClass}:${opts.grouped ? 'g' + opts.clusterIdx : 's'}|`;

    return `
      <div id="ev-${i}" class="event-card ${state}${nextClass}${animClass}"${inlineStyle}${dismissAttr} data-expandable>
        <div class="card-summary">
          ${avatarName ? `<div class="organizer-avatar"${locColor}>
            ${photoCache[avatarPerson.email] ? `<img class="avatar-img" src="${photoCache[avatarPerson.email]}" alt="">` : ''}
            <span class="avatar-initials">${escapeHtml(avatarInitials)}</span>
          </div>` : ''}
          <div class="card-main">
            <div class="event-title"${titleColor}>${escapeHtml(event.summary || '(No title)')}</div>
            <div class="event-time"${timeColor}>${startTimeStr}${countdown && state === 'current' ? ` · ${countdown}` : ''}</div>
          </div>
        </div>
        <div class="card-details">${details.join('')}</div>
      </div>
    `;
  }

  clusters.forEach((cluster, ci) => {
    const clusterStart = new Date(cluster.clusterStart);
    const firstEvent = cluster.events[0];
    const firstStart = new Date(firstEvent.start.dateTime);
    const firstEnd = new Date(firstEvent.end.dateTime);
    const firstState = now >= firstEnd ? 'past' : (now >= firstStart ? 'current' : 'future');

    // Timeline connector before this cluster
    let spacingPx = 0;
    if (firstState !== 'past' && clusterStart > cursor) {
      const gapMins = (clusterStart - cursor) / 60000;
      spacingPx = gapMargin(gapMins);
      if (gapMins >= 1) {
        const gapStartsNow = Math.abs(cursor - now) < 60000;
        const gapProgress = gapStartsNow ? Math.min(1, (now - cursor) / (clusterStart - cursor)) : -1;
        const nowLineHtml = gapStartsNow ? `<div class="now-line" style="top:${(gapProgress * 100).toFixed(1)}%"></div>` : '';
        const label = formatFreeTime(gapMins);
        html += `
          <div class="timeline-connector" style="height: ${Math.round(spacingPx)}px;">
            <div class="timeline-line"></div>
            ${nowLineHtml}
            <span class="timeline-label">${label}</span>
          </div>
        `;
        spacingPx = 0;
      }
    }

    if (cluster.isOverlapping) {
      // Render side-by-side
      const groupStyle = spacingPx > 0 ? ` style="margin-top: ${Math.round(spacingPx)}px;"` : '';
      html += `<div class="overlap-group"${groupStyle}>`;
      cluster.events.forEach(ev => {
        html += renderCard(ev, { spacingPx: 0, grouped: true, clusterIdx: ci, clusterStart: cluster.clusterStart });
      });
      html += `</div>`;
    } else {
      html += renderCard(firstEvent, { spacingPx, grouped: false, clusterIdx: ci });
    }

    // Advance cursor to end of cluster
    cursor = new Date(Math.max(cursor.getTime(), cluster.clusterEnd));
  });

  // Only rebuild DOM when structure changes (avoids restarting animations)
  if (structureKey !== lastStructureKey) {
    list.innerHTML = html;
    lastStructureKey = structureKey;

    // Tap to dismiss continuous throb (consumes the click — no expand)
    list.querySelectorAll('[data-dismiss]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (el.classList.contains('antsy')) {
          e.stopImmediatePropagation();
          dismissEvent(el.dataset.dismiss);
        }
      });
    });

    // Remove one-shot animation classes after they play
    list.querySelectorAll('.throb-small, .throb-medium, .throb-large').forEach(el => {
      el.addEventListener('animationend', () => {
        el.classList.remove('throb-small', 'throb-medium', 'throb-large');
      }, { once: true });
    });

    // Tap to expand/collapse card details
    list.querySelectorAll('[data-expandable]').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('expanded');
      });
    });
  } else {
    // Patch only dynamic values in-place
    list.querySelectorAll('.event-time').forEach(el => {
      const card = el.closest('.event-card');
      if (!card) return;
      const idx = card.id?.replace('ev-', '');
      const match = html.match(new RegExp(`id="ev-${idx}"[\\s\\S]*?class="event-time"[^>]*>([^<]+)<`));
      if (match) el.textContent = match[1];
    });
    list.querySelectorAll('.event-card.current').forEach(card => {
      const match = html.match(new RegExp(`id="${card.id}"[^>]*--progress:\\s*([\\d.]+)%`));
      if (match) card.style.setProperty('--progress', match[1] + '%');
    });
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


// Pick the most relevant person to show as the card avatar.
// If I organized it, show the most relevant attendee. Otherwise show the organizer.
function pickAvatarPerson(event) {
  const organizer = event.organizer || {};
  const attendees = event.attendees || [];
  const iAmOrganizer = organizer.self || attendees.some(a => a.self && a.organizer);

  if (!iAmOrganizer || attendees.length === 0) {
    return organizer;
  }

  // Filter to non-self, non-resource attendees
  const others = attendees.filter(a => !a.self && !a.resource);
  if (others.length === 0) return organizer;

  // Score each attendee for relevance:
  // - accepted > tentative > needsAction > declined
  // - fewer total attendees = more relevant (1:1 > large meeting)
  // - having a displayName is better (more personal)
  const statusScore = { accepted: 4, tentative: 3, needsAction: 2, declined: 0 };
  others.sort((a, b) => {
    const sa = statusScore[a.responseStatus] || 1;
    const sb = statusScore[b.responseStatus] || 1;
    if (sa !== sb) return sb - sa;
    // Prefer named attendees
    if (a.displayName && !b.displayName) return -1;
    if (!a.displayName && b.displayName) return 1;
    return 0;
  });

  return others[0];
}

function getInitials(name) {
  if (!name) return '';
  // Handle email addresses
  if (name.includes('@')) name = name.split('@')[0].replace(/[._]/g, ' ');
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || '').slice(0, 2).toUpperCase();
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
