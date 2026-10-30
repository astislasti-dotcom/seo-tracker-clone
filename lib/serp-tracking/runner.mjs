// Weekly SERP measurement engine. Dependencies are injected: `search` and `persist`.
// This module never imports SerpAPI, Supabase or Next.js. Callers decide what to inject.
import { ALLOWED_DOMAINS, STATES, classifyResponse, errorResult } from './classify.mjs';

export const MAX_KEYWORDS_PER_RUN = 31;
const MAX_KEYWORD_LENGTH = 200;

function normalizeKeyword(text) {
  return text.trim().toLowerCase();
}

// Returns valid, unique entries plus counts of what was skipped. Nothing is searched here.
export function validateKeywords(list) {
  if (!Array.isArray(list)) {
    return { valid: [], skipped: 0, tooMany: false, invalidInput: true };
  }

  const valid = [];
  const seen = new Set();
  let skipped = 0;

  for (const entry of list) {
    const id = entry?.id;
    const keyword = typeof entry?.keyword === 'string' ? entry.keyword.trim() : '';
    const domain = entry?.domain;

    const idOk = (typeof id === 'string' && id !== '') || Number.isInteger(id);
    if (!idOk || keyword === '' || keyword.length > MAX_KEYWORD_LENGTH || !ALLOWED_DOMAINS.includes(domain)) {
      skipped++;
      continue;
    }

    // Same keyword under the same brand is measured once. Different brands never collide.
    const key = `${domain}|${normalizeKeyword(keyword)}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    valid.push({ id, keyword, domain });
  }

  return {
    valid,
    skipped,
    tooMany: valid.length > MAX_KEYWORDS_PER_RUN,
    invalidInput: false,
  };
}

function emptyCounters(skipped = 0) {
  return { attempted: 0, ranked: 0, not_found: 0, failed: 0, saved: 0, skipped };
}

// Rows for a future storage adapter. Error items are never mapped, and not_found
// has position null, never 0. Not used by any live path yet.
export function toStorageRows(items, measuredAt) {
  return items
    .filter((item) => item.state === STATES.RANKED || item.state === STATES.NOT_FOUND)
    .map((item) => ({
      keyword_id: item.id,
      domain: item.domain,
      position: item.state === STATES.RANKED ? item.position : null,
      state: item.state,
      source: 'serpapi',
      measured_at: measuredAt,
    }));
}

export async function runWeeklyTracking({ keywords, search, persist, now = () => new Date() }) {
  if (typeof search !== 'function') {
    throw new TypeError('runWeeklyTracking: `search` must be a function');
  }

  const measuredAt = now().toISOString();
  const { valid, skipped, tooMany, invalidInput } = validateKeywords(keywords);

  if (invalidInput || tooMany) {
    return {
      status: 'refused',
      reason: invalidInput ? 'invalid_input' : 'too_many_keywords',
      persistence: 'none',
      updated: false,
      counters: emptyCounters(Array.isArray(keywords) ? keywords.length : 0),
      items: [],
      measured_at: measuredAt,
    };
  }

  if (valid.length === 0) {
    // Nothing to measure: no searches, nothing persisted, nothing claimed as updated.
    return {
      status: 'skipped',
      reason: 'no_eligible_keywords',
      persistence: 'none',
      updated: false,
      counters: emptyCounters(skipped),
      items: [],
      measured_at: measuredAt,
    };
  }

  const counters = emptyCounters(skipped);
  const items = [];

  // One search per keyword, sequential, no automatic retries.
  for (const kw of valid) {
    counters.attempted++;
    let result;
    try {
      const response = await search(kw);
      result = classifyResponse({ response, targetDomain: kw.domain });
    } catch {
      // Error text is deliberately not kept: it may contain request details.
      result = errorResult('request_failed');
    }

    if (result.state === STATES.RANKED) counters.ranked++;
    else if (result.state === STATES.NOT_FOUND) counters.not_found++;
    else counters.failed++;

    items.push({ id: kw.id, keyword: kw.keyword, domain: kw.domain, ...result });
  }

  // Persistence states:
  //   none    -> no persist injected (dry run, nothing written)
  //   empty   -> no storable rows (every eligible keyword failed)
  //   ok      -> persist resolved; contract: persist MUST throw when storage reports an error
  //   failed  -> persist threw
  let persistence = 'none';
  if (typeof persist === 'function') {
    // Errors are not persisted at all. Only real measurements reach storage.
    const rows = toStorageRows(items, measuredAt);
    if (rows.length === 0) {
      persistence = 'empty';
    } else {
      try {
        await persist(rows);
        counters.saved = rows.length;
        persistence = 'ok';
      } catch {
        persistence = 'failed';
      }
    }
  }

  // "completed" is reserved for: no failures AND observations actually saved.
  let status;
  let reason;
  if (counters.failed > 0 || persistence === 'failed') {
    status = 'partial';
  } else if (persistence === 'none') {
    status = 'dry_run';
    reason = 'persistence_not_injected';
  } else if (counters.saved > 0) {
    status = 'completed';
  } else {
    status = 'partial';
    reason = 'nothing_persisted';
  }

  const result = {
    status,
    persistence,
    updated: status === 'completed',
    counters,
    items,
    measured_at: measuredAt,
  };
  if (reason) result.reason = reason;
  return result;
}
