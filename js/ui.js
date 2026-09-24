// Kleine Helfer für die Oberfläche.

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
// Kurzer Hinweis unten. Optional mit einer Aktion, z. B. { label: 'Rückgängig', run: () => … }.
export function toast(msg, { action = null, ms = 3200 } = {}) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('<div class="toast"><span></span><button hidden></button></div>'); document.body.appendChild(el); }
  el.querySelector('span').textContent = msg;
  const btn = el.querySelector('button');
  btn.hidden = !action;
  btn.onclick = null;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { el.classList.remove('show'); action.run(); };
  }
  el.classList.toggle('actionable', Boolean(action));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Vollbild-Ansichten (Zeigen, Bearbeiten) ----------
// Die Zurück-Taste bzw. -Geste von Android schließt sie, wie man es erwartet.

let overlay = null;

export function openOverlay(el) {
  if (overlay) overlay.remove();
  else history.pushState({ overlay: true }, '');
  overlay = el;
  document.body.appendChild(el);
}

export function closeOverlay() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  if (history.state?.overlay) history.back();
}

window.addEventListener('popstate', () => {
  if (overlay) { overlay.remove(); overlay = null; }
});

export const FONT_SCALES = [1, 1.15, 1.3];

export function applyFontScale(v) {
  document.documentElement.style.setProperty('--scale', v);
}

import { today, daysBetween } from './srs.js';

export function formatDay(dateStr) {
  const n = daysBetween(today(), dateStr);
  if (n <= 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === 2) return 'übermorgen';
  if (n < 14) return `in ${n} Tagen`;
  const [y, m, d] = dateStr.split('-');
  return `am ${Number(d)}.${Number(m)}.${y !== today().slice(0, 4) ? y : ''}`;
}
