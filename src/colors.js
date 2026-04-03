// ── Color palettes & urgency helpers ────────────────────

import { calendarColors, calendarMeta, setCalendarColors } from './state.js';
import { hexToRgb } from './utils.js';

export async function fetchCalendarColors() {
  try {
    const resp = await gapi.client.calendar.colors.get();
    setCalendarColors(resp.result.event || {});
  } catch (e) {
    // Non-critical
  }
}

export function getEventColor(event) {
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

function luminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Background opacity: 1.0 at 0 min, fades to 0 at ~120 min
export function urgencyBgAlpha(minsUntil) {
  if (minsUntil <= 0) return 1;
  return Math.max(0, Math.exp(-0.02 * minsUntil));
}

export function urgencyTextColor(bgAlpha, r, g, b) {
  const effR = Math.round(10 + (r - 10) * bgAlpha);
  const effG = Math.round(10 + (g - 10) * bgAlpha);
  const effB = Math.round(15 + (b - 15) * bgAlpha);
  const bgLum = luminance(effR, effG, effB);

  const whiteContrast = (1 + 0.05) / (bgLum + 0.05);
  const darkContrast = (bgLum + 0.05) / (0.01 + 0.05);

  // Bias toward white text — on a dark-themed app, white is almost always more readable
  return whiteContrast > darkContrast * 0.6
    ? { title: '#ffffff', sub: 'rgba(255,255,255,0.85)' }
    : { title: '#111111', sub: 'rgba(0,0,0,0.65)' };
}
