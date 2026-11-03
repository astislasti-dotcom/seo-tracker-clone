// Maps Google API failures to stable codes. The message is a fixed sentence per code:
// the original error text is never forwarded, because it may echo request metadata.

const MESSAGES = Object.freeze({
  credentials_missing: 'La credencial de Search Console no está configurada.',
  credentials_invalid: 'La credencial de Search Console no es válida.',
  permission_denied: 'La cuenta de servicio no tiene acceso a esta propiedad.',
  property_not_found: 'La propiedad no existe o no es accesible con esta cuenta.',
  quota_exceeded: 'Se ha superado la cuota de Search Console. Inténtalo más tarde.',
  unavailable: 'Search Console no está disponible en este momento.',
  invalid_response: 'La respuesta de Search Console no tiene el formato esperado.',
  unknown: 'Error no identificado al consultar Search Console.',
});

export function gscErrorMessage(code) {
  return MESSAGES[code] ?? MESSAGES.unknown;
}

// `error` is whatever the transport threw. Only numeric status and a few known
// OAuth markers are read; nothing else is used.
export function mapGoogleError(error) {
  const status = Number(error?.code ?? error?.status ?? error?.response?.status);
  const oauth = String(error?.message ?? '').includes('invalid_grant');
  if (oauth || status === 401) return { code: 'credentials_invalid' };
  if (status === 403) return { code: 'permission_denied' };
  if (status === 404) return { code: 'property_not_found' };
  if (status === 429) return { code: 'quota_exceeded' };
  if (status >= 500 && status < 600) return { code: 'unavailable' };
  return { code: 'unknown' };
}
