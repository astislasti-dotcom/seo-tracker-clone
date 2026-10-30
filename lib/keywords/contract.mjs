// Catalog contract for display. Pure functions: no network, no Supabase, no Next.js.
//
// Identity is the logical key `domain|normalized keyword`. The JSON `id` is NOT an
// identity: it does not match the database id (IDs in DB are offset by a historical
// import accident), so it is never used to join measurements to keywords.
import { ALLOWED_DOMAINS } from '../serp-tracking/classify.mjs';

export const PRIORITIES = Object.freeze(['P1', 'P2', 'P3']);

export function normalizeKeyword(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function logicalKey(domain, keyword) {
  return `${domain}|${normalizeKeyword(keyword)}`;
}

// Validates the raw catalog and returns normalized entries. Fails closed: any invalid
// entry makes the whole catalog invalid, so the UI never shows a partial catalog as complete.
// Error messages carry positions and codes only, never keyword text.
export function buildCatalog(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, keywords: [], errors: ['catalog_not_array'] };
  }

  const errors = [];
  const keywords = [];
  const seen = new Set();

  raw.forEach((item, index) => {
    const keyword = typeof item?.keyword === 'string' ? item.keyword.trim() : '';
    if (keyword === '') {
      errors.push(`entry ${index}: empty_keyword`);
      return;
    }
    if (!ALLOWED_DOMAINS.includes(item.domain)) {
      errors.push(`entry ${index}: domain_not_allowed`);
      return;
    }
    if (!PRIORITIES.includes(item.priority)) {
      errors.push(`entry ${index}: invalid_priority`);
      return;
    }
    if (typeof item.intent !== 'string' || item.intent.trim() === '') {
      errors.push(`entry ${index}: missing_intent`);
      return;
    }
    const key = logicalKey(item.domain, keyword);
    if (seen.has(key)) {
      errors.push(`entry ${index}: duplicate_keyword`);
      return;
    }
    seen.add(key);
    keywords.push({
      key,
      keyword,
      domain: item.domain,
      priority: item.priority,
      intent: item.intent.trim(),
    });
  });

  return { ok: errors.length === 0, keywords: errors.length === 0 ? keywords : [], errors };
}
