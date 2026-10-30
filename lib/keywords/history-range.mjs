// Validates the page window requested by the dashboard. Pure.
import { PAGE_SIZE } from './paginate.mjs';

const MAX_OFFSET = 10_000_000;

export function parseRange(searchParams) {
  const from = toInt(searchParams.get('from'));
  const to = toInt(searchParams.get('to'));
  if (from === null || to === null) return { ok: false, error: 'invalid_range' };
  if (from < 0 || to < from || from > MAX_OFFSET) return { ok: false, error: 'invalid_range' };
  if (to - from + 1 > PAGE_SIZE) return { ok: false, error: 'range_too_large' };
  return { ok: true, from, to };
}

function toInt(value) {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}
