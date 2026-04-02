// ── Demo Mode ───────────────────────────────────────────

import {
  events, showTasks,
  setEvents, setCalendarColors, setCalendarMeta, setLastStructureKey,
} from './state.js';
import { renderEvents } from './render.js';

export function loadDemoEvents() {
  const now = new Date();
  const today = (h, m) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const nowH = now.getHours();
  const nowM = now.getMinutes();

  setCalendarColors({
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
  });

  setCalendarMeta({
    'work':     { backgroundColor: '#039be5' },
    'personal': { backgroundColor: '#7986cb' },
    'family':   { backgroundColor: '#33b679' },
  });

  setEvents([
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
  ]);

  setLastStructureKey('');
  renderEvents();
}

export function loadDemoTasks() {
  if (!showTasks) return;
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0];
  const demoTasks = [
    {
      summary: 'Submit expense report',
      start: { date: todayDate },
      end: { date: todayDate },
      _isTask: true,
      _taskListName: 'My Tasks',
      iCalUID: 'task-demo-1',
    },
    {
      summary: 'Review PR #42',
      start: { date: todayDate },
      end: { date: todayDate },
      _isTask: true,
      _taskListName: 'My Tasks',
      iCalUID: 'task-demo-2',
    },
  ];
  setEvents(events.filter(e => !e._isTask).concat(demoTasks));
  setLastStructureKey('');
  renderEvents();
}
