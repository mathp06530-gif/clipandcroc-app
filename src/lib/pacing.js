// Rythme de publication : délais aléatoires et plafond quotidien.

export function randomDelayMs(minSeconds, maxSeconds, random = Math.random) {
  const min = Math.max(0, Number(minSeconds) || 0);
  const max = Math.max(min, Number(maxSeconds) || min);
  const seconds = min + (max - min) * random();
  return Math.round(seconds * 1000);
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
  }
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function remainingToday(counter, limit, date = new Date()) {
  const key = todayKey(date);
  const used = counter && counter.date === key ? Number(counter.count) || 0 : 0;
  const max = Number(limit) || 0;
  if (max <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, max - used);
}

export function bumpCounter(counter, date = new Date()) {
  const key = todayKey(date);
  const used = counter && counter.date === key ? Number(counter.count) || 0 : 0;
  return { date: key, count: used + 1 };
}
