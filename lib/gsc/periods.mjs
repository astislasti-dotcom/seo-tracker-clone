// Pure date windows. `now` is injected so tests are deterministic.
import { ALLOWED_PERIODS, ASSUMED_FINAL_LAG_DAYS } from './constants.mjs';

const DAY_MS = 86_400_000;

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function parsePeriod(value) {
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return ALLOWED_PERIODS.includes(n) ? n : null;
}

// Inclusive window of `days` days ending at (today - lag), in UTC.
export function periodWindow(days, now = new Date(), lagDays = ASSUMED_FINAL_LAG_DAYS) {
  if (!ALLOWED_PERIODS.includes(days)) throw new RangeError('unsupported period');
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endMs = todayUtc - lagDays * DAY_MS;
  const startMs = endMs - (days - 1) * DAY_MS;
  return { startDate: isoDate(startMs), endDate: isoDate(endMs), days };
}
