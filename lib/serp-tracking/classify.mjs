// Pure classification of one SERP response for one keyword/domain.
// No network, no Next.js, no Supabase. Inputs are already-parsed JSON.

export const STATES = Object.freeze({
  RANKED: 'ranked',
  NOT_FOUND: 'not_found',
  ERROR: 'error',
});

export const ALLOWED_DOMAINS = Object.freeze(['3av.events', 'astisl.es']);

// SerpAPI answers HTTP 200 with this message when a query has no organic results.
// That is a real "no results" answer, not a provider failure.
const NO_RESULTS_MESSAGE = /hasn'?t returned any results/i;

export function hostnameOf(link) {
  if (typeof link !== 'string' || link === '') return null;
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Exact host or a real subdomain of the target. Substring matches are rejected
// so that "evilastisl.es" or "astisl.es.example.net" never count as ASTI.
export function hostMatches(host, targetDomain) {
  if (!host || !targetDomain) return false;
  return host === targetDomain || host.endsWith(`.${targetDomain}`);
}

export function errorResult(reason) {
  return { state: STATES.ERROR, position: null, resultsReturned: null, reason };
}

export function classifyResponse({ response, targetDomain }) {
  if (!ALLOWED_DOMAINS.includes(targetDomain)) {
    return errorResult('invalid_target_domain');
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return errorResult('malformed_response');
  }

  if (typeof response.error === 'string') {
    if (NO_RESULTS_MESSAGE.test(response.error)) {
      return { state: STATES.NOT_FOUND, position: null, resultsReturned: 0 };
    }
    return errorResult('provider_error');
  }

  const organic = response.organic_results;
  if (!Array.isArray(organic)) {
    return errorResult('malformed_response');
  }

  let bestPosition = null;
  for (const item of organic) {
    if (!hostMatches(hostnameOf(item?.link), targetDomain)) continue;
    // Only the provider's own position is trusted. Array index is not a SERP position.
    if (!Number.isInteger(item.position) || item.position < 1) {
      return errorResult('position_missing');
    }
    if (bestPosition === null || item.position < bestPosition) {
      bestPosition = item.position;
    }
  }

  if (bestPosition !== null) {
    return { state: STATES.RANKED, position: bestPosition, resultsReturned: organic.length };
  }
  return { state: STATES.NOT_FOUND, position: null, resultsReturned: organic.length };
}
