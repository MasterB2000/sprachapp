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
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('<div class="toast"></div>'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
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
