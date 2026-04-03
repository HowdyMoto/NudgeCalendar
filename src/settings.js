// ── Settings panel ──────────────────────────────────────

import { APP_VERSION, DEMO_MODE } from './config.js';
import { events, showTasks, setShowTasks as setShowTasksState, setEvents, setLastStructureKey } from './state.js';
import { renderEvents } from './render.js';
import { fetchTasks } from './api.js';
import { loadDemoTasks } from './demo.js';

export function setScale(value) {
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

export function setShowTasks(on) {
  setShowTasksState(on);
  localStorage.setItem('show_tasks', on);
  const toggle = document.getElementById('tasks-toggle');
  if (toggle) toggle.checked = on;
  setLastStructureKey('');
  if (on && !DEMO_MODE && typeof gapi !== 'undefined' && gapi.client?.getToken()) {
    fetchTasks();
  } else if (on && DEMO_MODE) {
    loadDemoTasks();
  } else {
    setEvents(events.filter(e => !e._isTask));
    renderEvents();
  }
}

function initShowTasks() {
  const saved = localStorage.getItem('show_tasks') !== 'false';
  setShowTasks(saved);
}

export function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  const scrim = document.getElementById('settings-scrim');
  panel.classList.toggle('hidden');
  scrim.classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('settings-panel');
  const scrim = document.getElementById('settings-scrim');
  const btn = document.getElementById('settings-btn');
  if (!panel.classList.contains('hidden') &&
      !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.add('hidden');
    scrim.classList.add('hidden');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initScale();
  initShowTasks();
});

// Set version
const verEl = document.getElementById('app-version');
if (verEl) verEl.textContent = `v${APP_VERSION}`;
