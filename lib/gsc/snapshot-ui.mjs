// GSC-06E · lógica pura de la vista «Consultas y páginas». Sin React, sin red, sin Supabase.
//
// Reglas:
//   · Cada propiedad (ASTI, 3AV) tiene su propia petición y su propia paginación. Nunca se mezclan
//     consultas, URLs, posiciones ni promedios entre dominios.
//   · Se pide siempre con limit=100 (límite máximo de la API: 500). El offset viene de la paginación.
//   · Una respuesta solo se acepta si coincide con lo pedido (dominio, dimensión y periodo).
//   · Ausencia de captura («missing») y captura válida sin filas son estados distintos. No se pintan ceros.
//   · Los enlaces de páginas solo se crean si la URL es HTTPS y su host es exactamente astisl.es o 3av.events.

export const SNAPSHOT_HOSTS = Object.freeze(['astisl.es', '3av.events']);
export const SNAPSHOT_DIMENSIONS = Object.freeze(['query', 'page']);
export const SNAPSHOT_PERIODS = Object.freeze([7, 28, 90]);
export const SNAPSHOT_PAGE_SIZE = 100;
export const SNAPSHOT_MAX_OFFSET = 4999;
export const SNAPSHOT_API_PATH = '/api/gsc/snapshots';

export const SNAPSHOT_BRANDS = Object.freeze([
  { id: 'all', label: 'Todas' },
  { id: 'astisl.es', label: 'ASTI' },
  { id: '3av.events', label: '3AV' },
]);

export const SNAPSHOT_NOTICE = 'Filas principales disponibles en Search Console; no representa todas las búsquedas.';
export const SNAPSHOT_TRUNCATED_NOTICE = 'La captura alcanzó el límite de 5.000 filas en origen. Puede faltar información.';

const MESSAGES = Object.freeze({
  loading: 'Cargando consultas…',
  missing: 'No hay captura vigente para esta marca, dimensión y periodo. No se muestran datos.',
  invalid: 'La captura recibida no coincide con lo solicitado. No se muestra.',
  error: 'No se pudieron cargar las capturas. Vuelve a intentarlo más tarde.',
  unauthorized: 'Tu sesión ha caducado. Vuelve a iniciar sesión para ver estos datos.',
  forbidden: 'Esta sección está reservada a la persona responsable del proyecto.',
  emptyPage: 'Esta página no tiene filas. Vuelve a la primera página.',
  emptySnapshot: 'La captura es válida pero no tiene filas en esta ventana.',
});

export function messageFor(key) {
  return MESSAGES[key] ?? MESSAGES.error;
}

export function groupsFor(brand) {
  if (brand === 'all') return SNAPSHOT_HOSTS.slice();
  return SNAPSHOT_HOSTS.includes(brand) ? [brand] : [];
}

function isBoundedInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// Construye la URL de la API para una sola propiedad. Rechaza valores fuera del contrato.
export function buildSnapshotUrl({ domain, dimension, period, offset = 0 }) {
  if (!SNAPSHOT_HOSTS.includes(domain)) return null;
  if (!SNAPSHOT_DIMENSIONS.includes(dimension)) return null;
  if (!SNAPSHOT_PERIODS.includes(period)) return null;
  if (!isBoundedInt(offset, 0, SNAPSHOT_MAX_OFFSET)) return null;
  const params = new URLSearchParams({
    brand: domain,
    dimension,
    period: String(period),
    limit: String(SNAPSHOT_PAGE_SIZE),
    offset: String(offset),
  });
  return `${SNAPSHOT_API_PATH}?${params.toString()}`;
}

// Clasifica una respuesta HTTP ya leída. Nunca devuelve el texto original de la API.
export function classifyResponse({ status, body, expected }) {
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 403) return { kind: 'forbidden' };
  if (status !== 200) return { kind: 'error' };
  if (body === null || typeof body !== 'object' || !Array.isArray(body.snapshots) || !Array.isArray(body.missing)) {
    return { kind: 'invalid' };
  }
  const matches = (entry) =>
    entry &&
    entry.domain === expected.domain &&
    entry.dimension === expected.dimension &&
    entry.periodDays === expected.period;
  if (!body.snapshots.every(matches) || !body.missing.every(matches)) return { kind: 'invalid' };
  if (body.snapshots.length + body.missing.length !== 1) return { kind: 'invalid' };

  if (body.snapshots.length === 0) return { kind: 'missing' };
  const snapshot = body.snapshots[0];
  if (snapshot.returned === 0 && snapshot.totalAvailable > 0) return { kind: 'emptyPage', snapshot };
  if (snapshot.totalAvailable === 0) return { kind: 'emptySnapshot', snapshot };
  return { kind: 'data', snapshot };
}

// Enlace seguro para una URL de página. Devuelve el href o null (en ese caso se muestra solo el texto).
export function safePageLink(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 2048) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.port !== '') return null;
  if (!SNAPSHOT_HOSTS.includes(url.hostname)) return null;
  return url.href;
}

// Número de página y navegación, a partir del offset y del total de la captura.
export function paginationFor(snapshot, offset) {
  const total = snapshot?.totalAvailable ?? 0;
  const size = SNAPSHOT_PAGE_SIZE;
  const page = Math.floor(offset / size) + 1;
  const pages = Math.max(1, Math.ceil(total / size));
  return {
    page,
    pages,
    hasPrev: offset > 0,
    hasNext: Boolean(snapshot?.hasMore),
    prevOffset: Math.max(0, offset - size),
    nextOffset: offset + size,
  };
}

// Formato con separadores españoles. Nunca inventa un valor: null se muestra como guion.
const NF_INT = new Intl.NumberFormat('es-ES');
const NF_ONE = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatCount(value) {
  return Number.isFinite(value) ? NF_INT.format(value) : '—';
}

export function formatCtr(ctr) {
  return Number.isFinite(ctr) ? `${NF_ONE.format(ctr * 100)} %` : '—';
}

export function formatPosition(position) {
  return Number.isFinite(position) ? NF_ONE.format(position) : '—';
}

function formatIsoDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatWindow(window) {
  if (!window) return '—';
  return `${formatIsoDate(window.startDate)} – ${formatIsoDate(window.endDate)}`;
}

// Hora de inicio de la captura, en horario de Madrid. No es «última actualización de datos».
export function formatCaptureStart(requestedAt) {
  const date = new Date(requestedAt);
  if (Number.isNaN(date.getTime())) return '—';
  const text = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${text} (hora de Madrid)`;
}

// Control de respuestas obsoletas: solo la última petición lanzada puede aplicar su resultado.
export function createRequestGate() {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    isCurrent(id) {
      return id === current;
    },
  };
}
