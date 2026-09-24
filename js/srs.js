// Wiederholungsabstände.
// Saß → Abstand wächst (1 → 3 → 8 → 20 → 50 Tage …). Saß nicht → morgen wieder.

const FACTOR = 2.5;

export function today() {
  return new Date().toLocaleDateString('sv'); // JJJJ-MM-TT in Ortszeit
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d + n).toLocaleDateString('sv');
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

// Nur Wendungen mit englischer Fassung können geübt werden.
export const isReady = (p) => Boolean(p.en);
export const isNew = (p) => isReady(p) && p.reps === 0;
export const isDue = (p, day = today()) => isReady(p) && p.reps > 0 && p.due <= day;

export function grade(p, ok, day = today()) {
  if (ok) {
    p.interval = p.interval ? Math.max(p.interval + 1, Math.round(p.interval * FACTOR)) : 1;
    p.streak += 1;
  } else {
    p.interval = 1;
    p.streak = 0;
    p.lapses += 1;
  }
  p.reps += 1;
  if (!p.firstSeen) p.firstSeen = day;
  p.lastReviewed = day;
  p.due = addDays(day, p.interval);
  p.updated = Date.now();
  return p;
}

// Wie viel Text beim Aufdecken zu sehen ist:
//   0 = Text sichtbar, blendet mit der Stimme aus
//   1 = Text auf Antippen
//   2 = ohne Text (erst nach der Bewertung)
// Ab Schieberstufe 4 eine Stufe strenger.
export function textStage(p, level) {
  const base = p.streak >= 6 ? 2 : p.streak >= 3 ? 1 : 0;
  return Math.min(2, base + (level >= 4 ? 1 : 0));
}

// Stellt die Tagesrunde zusammen: erst Fälliges, dann eine begrenzte Zahl neuer Wendungen.
export function buildQueue(phrases, { newPerDay, ignoreNewLimit = false }, day = today()) {
  const due = phrases.filter((p) => isDue(p, day)).sort((a, b) => a.due.localeCompare(b.due));
  const newToday = phrases.filter((p) => p.firstSeen === day).length;
  const room = ignoreNewLimit ? Infinity : Math.max(0, newPerDay - newToday);
  const fresh = phrases.filter(isNew).sort((a, b) => a.created - b.created).slice(0, room);
  return [...due, ...fresh];
}

export function nextDue(phrases, day = today()) {
  const upcoming = phrases.filter((p) => isReady(p) && p.reps > 0 && p.due > day).map((p) => p.due).sort();
  if (!upcoming.length) return null;
  const date = upcoming[0];
  return { date, count: upcoming.filter((d) => d === date).length };
}
