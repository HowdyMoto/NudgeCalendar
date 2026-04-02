// ── Shared utility functions ────────────────────────────

import { firedMilestones } from './state.js';

export function minsOf(a, b) { return (a - b) / 60000; }

export function eventKey(event) {
  const t = event.start.dateTime || event.start.date;
  return `${event.summary || ''}|${t}`;
}

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatCountdown(ms) {
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

export function hexToRgb(hex) {
  const m = hex && hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function getInitials(name) {
  if (!name) return '';
  if (name.includes('@')) name = name.split('@')[0].replace(/[._]/g, ' ');
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || '').slice(0, 2).toUpperCase();
}

export function checkMilestone(key, minsUntil) {
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
