// ── Google Calendar & Tasks API ──────────────────────────

import {
  events, showTasks, calendarMeta, photoCache,
  setEvents, setCalendarMeta, setLastStructureKey,
} from './state.js';
import { renderEvents } from './render.js';
import { showScreen, authScreen } from './ui.js';
import { silentReauth } from './auth.js';
import { DEMO_MODE } from './config.js';

// ── Fetch profile photos via People API ──────────────────

export async function fetchPhotos(emails) {
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
    setLastStructureKey('');
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

export { pickAvatarPerson };

export async function fetchEvents(isRetry) {
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
    setEvents(results.flat()
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
      }));

    setLastStructureKey('');
    renderEvents();

    const emails = events.map(e => pickAvatarPerson(e).email).filter(Boolean);
    if (emails.length) fetchPhotos([...new Set(emails)]);
  } catch (err) {
    console.error('Failed to fetch events:', err);
    if (err.status === 401) {
      // Token expired — try silent reauth
      const ok = await silentReauth();
      if (ok) return fetchEvents(true);
      // Silent reauth failed — don't boot to login, just clear token
      // and let the next user interaction or visibility change retry
      console.warn('Token expired, silent reauth failed — will retry on next refresh');
      localStorage.removeItem('gapi_token');
    }
  }
}

// ── Fetch Tasks ─────────────────────────────────────────

export async function fetchTasks() {
  if (!showTasks || !gapi.client.tasks) return;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  try {
    const listsResp = await gapi.client.tasks.tasklists.list({ maxResults: 100 });
    const taskLists = listsResp.result.items || [];

    const fetches = taskLists.map(tl =>
      gapi.client.tasks.tasks.list({
        tasklist: tl.id,
        dueMin: startOfDay.toISOString(),
        dueMax: endOfDay.toISOString(),
        showCompleted: false,
        showHidden: false,
        maxResults: 100,
      }).then(resp => (resp.result.items || []).map(t => ({
        ...t,
        _taskListName: tl.title,
      }))).catch(() => [])
    );

    const results = await Promise.all(fetches);
    const tasks = results.flat().filter(t => t.status !== 'completed');

    const taskEvents = tasks.map(t => ({
      summary: t.title || '(No title)',
      start: { date: t.due ? t.due.split('T')[0] : now.toISOString().split('T')[0] },
      end: { date: t.due ? t.due.split('T')[0] : now.toISOString().split('T')[0] },
      _isTask: true,
      _taskListName: t._taskListName,
      iCalUID: `task-${t.id}`,
    }));

    setEvents(events.filter(e => !e._isTask).concat(taskEvents)
      .sort((a, b) => {
        const aTime = a.start.dateTime || a.start.date || '';
        const bTime = b.start.dateTime || b.start.date || '';
        return aTime.localeCompare(bTime);
      }));

    setLastStructureKey('');
    renderEvents();
  } catch (err) {
    console.warn('Failed to fetch tasks:', err);
  }
}
