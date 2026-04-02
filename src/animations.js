// ── Emoji animations & event dismiss ────────────────────

import { dismissedEvents } from './state.js';
import { renderEvents } from './render.js';

const positiveEmojis = [
  '👍', '🚀', '💪', '🔥', '⚡', '🎯', '🫡', '🤘', '✌️',
  '😎', '🥳', '🫶', '💅', '🦾', '👊', '🤙', '🙌',
  '🎸', '🏆', '💥', '✨', '🤌', '🫰', '🧠', '💯',
];

export function spawnThumbsUp(x, y) {
  const el = document.createElement('div');
  el.className = 'thumbs-up';
  el.textContent = positiveEmojis[Math.floor(Math.random() * positiveEmojis.length)];
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);

  const dx = (Math.random() - 0.5) * 200;
  const rot = dx * 0.3;
  const duration = 2100;
  const launchVy = -620;
  const gravity = 1000;
  const frames = 32;
  const keyframes = [];
  for (let i = 0; i <= frames; i++) {
    const t = i / frames;
    const sec = t * duration / 1000;
    const py = launchVy * sec + 0.5 * gravity * sec * sec;
    const px = dx * t;
    const r = rot * t;
    const opacity = t < 0.1 ? t / 0.1 : Math.max(0, 1 - (t - 0.5) * 2);
    keyframes.push({
      transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${r}deg)`,
      opacity,
    });
  }
  const anim = el.animate(keyframes, { duration, easing: 'linear', fill: 'forwards' });
  anim.onfinish = () => el.remove();
}

export function dismissEvent(key, e) {
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

    if (e) spawnThumbsUp(e.clientX, e.clientY);

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
