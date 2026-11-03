// Pure helpers for the owner's email and password login. No network and no Supabase
// import, so they can be tested offline. Every credential failure shares one message, so
// the page never reveals whether an email exists, is unconfirmed, or is not the owner.

export const MSG_CREDENTIALS = 'No se pudo iniciar sesión. Revisa el correo y la contraseña.';
export const MSG_RATE_LIMIT = 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.';
export const MSG_NETWORK = 'No se pudo conectar. Inténtalo de nuevo.';
export const MSG_LOGOUT_FAILED = 'No se pudo cerrar la sesión en este navegador. Inténtalo de nuevo.';

const RATE_LIMIT_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit', 'too_many_requests']);

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// error: the error object returned by supabase.auth.signInWithPassword (or a thrown error).
// Returns the message to show, or null when there is no error.
export function loginErrorMessage(error) {
  if (!error) return null;
  const status = Number(error.status);
  if (status === 429 || RATE_LIMIT_CODES.has(error.code)) return MSG_RATE_LIMIT;
  if (status >= 400 && status < 500) return MSG_CREDENTIALS;
  return MSG_NETWORK;
}

// Local sign-out: clears this browser's session only. Returns true when it succeeded.
// It never throws, so the caller decides what to show.
export async function signOutSafely(auth) {
  try {
    const { error } = await auth.signOut({ scope: 'local' });
    return !error;
  } catch {
    return false;
  }
}
