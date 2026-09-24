// Wiederholungsabstände.
//   Sitzt      → Abstand wächst deutlich (1 → 3 → 8 → 20 → 50 Tage …)
//   Wackelig   → Abstand wächst nur wenig
//   Noch nicht → morgen wieder

const FACTOR = 2.5;
const HARD_FACTOR = 1.2;

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

// Geübt wird, was beide Sprachen hat und nicht auf "nur übersetzen" steht.
export const isReady = (p) => Boolean(p.en && p.de) && p.learn !== false;
export const isNew = (p) => isReady(p) && p.reps === 0;
export const isDue = (p, day = today()) => isReady(p) && p.reps > 0 && p.due <= day;

// rating: 'good' (Sitzt) | 'hard' (Wackelig) | 'again' (Noch nicht)
export function grade(p, rating, day = today()) {
  if (rating === 'good') {
    p.interval = p.interval ? Math.max(p.interval + 1, Math.round(p.interval * FACTOR)) : 1;
    p.streak += 1;
  } else if (rating === 'hard') {
    p.interval = p.interval ? Math.max(p.interval + 1, Math.round(p.interval * HARD_FACTOR)) : 1;
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
