// ── Morning Briefing ────────────────────────────────────

import { events } from './state.js';
import { todayString, escapeHtml, hexToRgb } from './utils.js';
import { getEventColor } from './colors.js';
import { spawnThumbsUp } from './animations.js';

export function checkMorningBriefing() {
  const ackDate = localStorage.getItem('briefing_ack_date');
  if (ackDate === todayString()) return;

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

    const rgb = hexToRgb(getEventColor(event));
    const r = rgb ? rgb.r : 74;
    const g = rgb ? rgb.g : 158;
    const b = rgb ? rgb.b : 255;

    return `
      <div class="briefing-card" style="background: rgba(${r},${g},${b},0.35);">
        <div class="bc-time">${fmt(start)} – ${fmt(end)}</div>
        <div class="bc-title">${escapeHtml(event.summary || '(No title)')}</div>
      </div>
    `;
  }).join('');

  overlay.classList.remove('hidden');

  const cards = cardsContainer.querySelectorAll('.briefing-card');
  cards.forEach((card, i) => {
    setTimeout(() => {
      card.classList.add('cascade-in');
    }, i * 300);
  });

  const totalDelay = cards.length * 300 + 600;
  setTimeout(() => {
    dismissBtn.classList.remove('hidden');
    dismissBtn.classList.add('visible');
  }, totalDelay);

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

  dismissBtn.addEventListener('click', (e) => {
    spawnThumbsUp(e.clientX, e.clientY);
    dismiss();
  }, { once: true });

  const list = document.getElementById('events-list');
  const scrollDismiss = () => {
    if (!overlay.classList.contains('hidden')) {
      dismiss();
      list.removeEventListener('scroll', scrollDismiss);
    }
  };
  list.addEventListener('scroll', scrollDismiss, { passive: true });
}
