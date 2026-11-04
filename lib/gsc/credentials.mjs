// Parses the service-account JSON from an injected string (in production:
// process.env.GSC_SERVICE_ACCOUNT_JSON, server side only). Fails closed. Errors carry
// only a code; they never include the input, the key or any parsed field.

export function parseServiceAccount(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, code: 'credentials_missing' };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'credentials_invalid' };
  }

  const valid =
    parsed &&
    typeof parsed === 'object' &&
    parsed.type === 'service_account' &&
    typeof parsed.client_email === 'string' &&
    parsed.client_email.includes('@') &&
    typeof parsed.private_key === 'string' &&
    parsed.private_key.includes('PRIVATE KEY');
  if (!valid) return { ok: false, code: 'credentials_invalid' };

  return { ok: true, credentials: { client_email: parsed.client_email, private_key: parsed.private_key } };
}
