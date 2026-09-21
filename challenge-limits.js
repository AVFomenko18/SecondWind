export const DAILY_CHALLENGE_ID = 'challenge-power-calls';

export function moscowDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

export function dailyChallengeAdditionsValid(before, after) {
  const previous = Array.isArray(before?.ledger) ? before.ledger : [];
  const incoming = Array.isArray(after?.ledger) ? after.ledger : [];
  const previousIds = new Set(previous.map(entry => entry?.id).filter(Boolean));
  const usedDays = new Set();
  const isDaily = entry => entry?.source === 'challenge' &&
    typeof entry.ref === 'string' && entry.ref.startsWith(DAILY_CHALLENGE_ID + ':');
  for (const entry of previous) if (isDaily(entry)) {
    const day = moscowDay(entry.at);
    if (day) usedDays.add(entry.playerId + ':' + day);
  }
  for (const entry of incoming) {
    if (previousIds.has(entry?.id) || !isDaily(entry)) continue;
    const day = moscowDay(entry.at);
    if (!day) return false;
    const key = entry.playerId + ':' + day;
    if (usedDays.has(key)) return false;
    usedDays.add(key);
  }
  return true;
}
