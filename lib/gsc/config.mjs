// Brand → Search Console property. Pure: the config object is injected by the caller.
// A property is usable only when siteUrl is a non-empty string in one of the two
// documented formats. Nothing is assumed about the format of an unconfirmed property.

const SITE_URL_PATTERN = /^(sc-domain:[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/[^\s/]+\/.*)$/i;

export function resolveProperty(config, domain) {
  if (typeof domain !== 'string' || !Object.prototype.hasOwnProperty.call(config ?? {}, domain)) {
    return { ok: false, code: 'invalid_brand' };
  }
  const entry = config[domain];
  if (!entry || typeof entry !== 'object') return { ok: false, code: 'invalid_brand' };
  if (typeof entry.siteUrl !== 'string' || entry.siteUrl.trim() === '') {
    return { ok: false, code: 'property_not_configured' };
  }
  const siteUrl = entry.siteUrl.trim();
  if (!SITE_URL_PATTERN.test(siteUrl)) return { ok: false, code: 'property_not_configured' };
  return { ok: true, domain, brand: entry.brand ?? domain, siteUrl };
}
