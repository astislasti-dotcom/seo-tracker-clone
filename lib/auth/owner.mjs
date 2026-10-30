// Single-owner gate for server routes. Pure: the token verifier is injected, so the
// rules can be tested offline. Fails closed on every ambiguous input.

export function bearerToken(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

// verifyAccessToken(token) -> { email } | null. It may throw; a throw means "not verified".
export async function authorizeOwner({ authorization, ownerEmail, verifyAccessToken }) {
  const owner = typeof ownerEmail === 'string' ? ownerEmail.trim().toLowerCase() : '';
  if (owner === '') return { ok: false, status: 503, error: 'owner_not_configured' };

  const token = bearerToken(authorization);
  if (!token) return { ok: false, status: 401, error: 'unauthorized' };

  let identity = null;
  try {
    identity = await verifyAccessToken(token);
  } catch {
    identity = null;
  }
  const email = typeof identity?.email === 'string' ? identity.email.trim().toLowerCase() : '';
  if (email === '') return { ok: false, status: 401, error: 'unauthorized' };
  if (email !== owner) return { ok: false, status: 403, error: 'forbidden' };

  return { ok: true, email };
}
