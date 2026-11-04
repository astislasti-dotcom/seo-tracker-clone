// Prueba controlada de LECTURA en Google Search Console (ASTI y 3AV Events).
// Solo lectura: searchanalytics.query con webmasters.readonly. No escribe nada, no usa
// Supabase, no usa Vercel y no imprime claves, tokens ni la dirección de la cuenta de servicio.
//
// El JSON de la cuenta de servicio se lee SOLO desde una ruta local indicada por el propietario.
// Debe estar FUERA de la carpeta del proyecto (así no puede entrar en un commit).
//
// Uso (desde la carpeta del proyecto, con dependencias instaladas):
//   ... "C:\ruta\fuera\del\proyecto\clave.json" --fingerprint        (solo huellas, sin red)
//   ... "C:\ruta\fuera\del\proyecto\clave.json" --check              (valida identidad, sin red)
//   ... "C:\ruta\fuera\del\proyecto\clave.json" --confirm-real-call   (una consulta por propiedad)

import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROPERTIES = Object.freeze([
  Object.freeze({ brand: 'ASTI', siteUrl: 'https://astisl.es/' }),
  Object.freeze({ brand: '3AV', siteUrl: 'sc-domain:3av.events' }),
]);
export const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const LAG_DAYS = 3;        // supuesto de la integración, no verificado
export const WINDOW_DAYS = 28;
export const MAX_KEY_BYTES = 32 * 1024;

export class AbortRun extends Error {}
const abort = (message) => { throw new AbortRun(message); };

// Ruta: debe existir, ser un archivo normal, tener tamaño razonable y estar fuera del proyecto.
export async function checkKeyPath(keyPath, projectRoot = process.cwd()) {
  if (typeof keyPath !== 'string' || keyPath.trim() === '') abort('Falta la ruta del archivo JSON.');
  const absolute = path.resolve(keyPath);
  const root = path.resolve(projectRoot);
  const relative = path.relative(root, absolute);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    abort('El JSON está dentro de la carpeta del proyecto. Muévelo fuera antes de continuar.');
  }
  let info;
  try { info = await stat(absolute); } catch { abort('No se encuentra el archivo indicado.'); }
  if (!info.isFile()) abort('La ruta no es un archivo.');
  if (info.size === 0 || info.size > MAX_KEY_BYTES) abort('El archivo tiene un tamaño no válido para una clave de cuenta de servicio.');
  return absolute;
}

// Valida el JSON sin devolver ni mostrar sus campos sensibles.
export function parseKeyFile(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'el archivo no es JSON válido' }; }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'el JSON no tiene la forma esperada' };
  if (parsed.type !== 'service_account') return { ok: false, reason: 'no es una cuenta de servicio (campo type)' };
  if (typeof parsed.client_email !== 'string' || !parsed.client_email.includes('@')) return { ok: false, reason: 'falta el campo client_email' };
  if (typeof parsed.private_key !== 'string' || !parsed.private_key.includes('PRIVATE KEY')) return { ok: false, reason: 'falta el campo private_key' };
  if (typeof parsed.project_id !== 'string' || parsed.project_id.trim() === '') return { ok: false, reason: 'falta el campo project_id' };
  return {
    ok: true,
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
  };
}

// Identidad: se compara la huella SHA-256 del project_id y del client_email con las huellas
// esperadas guardadas en config/gsc-expected-service-account.json. Las huellas no son
// identificadores; los valores reales nunca se muestran ni se guardan en el repositorio.
export const EXPECTED_IDENTITY_PATH = fileURLToPath(new URL('../../config/gsc-expected-service-account.json', import.meta.url));

export function fingerprint(value, namespace = 'gsc-first-read:v1:') {
  return createHash('sha256').update(namespace + value).digest('hex');
}

// expected: contenido de config/gsc-expected-service-account.json. Falla cerrado si falta algo.
export function checkIdentity(key, expected) {
  if (!key?.ok) return { ok: false, reason: 'clave no válida' };
  const projectHash = expected?.projectIdSha256;
  const emailHash = expected?.clientEmailSha256;
  if (typeof projectHash !== 'string' || typeof emailHash !== 'string') {
    return { ok: false, reason: 'identidad esperada no configurada; ejecuta --fingerprint y registra las huellas' };
  }
  const ns = typeof expected.namespace === 'string' ? expected.namespace : 'gsc-first-read:v1:';
  const projectOk = fingerprint(key.projectId, ns) === projectHash;
  const emailOk = fingerprint(key.clientEmail, ns) === emailHash;
  if (!projectOk || !emailOk) return { ok: false, reason: 'la clave no corresponde al proyecto ni a la cuenta de servicio esperados' };
  return { ok: true };
}

async function loadExpectedIdentity() {
  try {
    return JSON.parse(await readFile(EXPECTED_IDENTITY_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function windowFor(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const end = today - LAG_DAYS * 86_400_000;
  const start = end - (WINDOW_DAYS - 1) * 86_400_000;
  return { startDate: iso(start), endDate: iso(end) };
}

// Solo códigos y motivos: nunca mensajes, cuerpos de respuesta ni credenciales.
export function describeError(error) {
  const status = error?.code ?? error?.response?.status ?? 'sin_estado';
  const reason = error?.errors?.[0]?.reason ?? null;
  return `estado ${status}${reason ? `, motivo ${reason}` : ''}`;
}

export function formatRow(brand, data, window) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const first = data?.metadata?.first_incomplete_date ?? 'no indicado';
  if (rows.length > 1) return `${brand}: respuesta inesperada (más de una fila sin dimensiones).`;
  if (rows.length === 0) return `${brand}: sin datos en ${window.startDate} → ${window.endDate} (primer día incompleto: ${first}).`;
  const r = rows[0];
  const ctr = r.impressions > 0 ? `${((r.clicks / r.impressions) * 100).toFixed(2)} %` : '—';
  const pos = r.impressions > 0 ? Number(r.position).toFixed(1) : '—';
  return `${brand}: clics ${r.clicks} · impresiones ${r.impressions} · CTR ${ctr} · posición media GSC ${pos} · primer día incompleto ${first}.`;
}

async function main() {
  const [keyPathArg, mode] = process.argv.slice(2);
  const modes = ['--fingerprint', '--check', '--confirm-real-call'];
  if (!keyPathArg || !modes.includes(mode)) {
    throw new AbortRun('Uso: node scripts/gsc/gsc-first-read.mjs "<ruta-fuera-del-proyecto.json>" --fingerprint | --check | --confirm-real-call');
  }
  const keyPath = await checkKeyPath(keyPathArg);
  const key = parseKeyFile(await readFile(keyPath, 'utf8'));
  if (!key.ok) abort(`Clave no válida: ${key.reason}. No se ha hecho ninguna llamada.`);

  if (mode === '--fingerprint') {
    // Solo huellas: no se muestran identificadores. Sin red.
    console.log(`Huella project_id (sha256): ${fingerprint(key.projectId)}`);
    console.log(`Huella client_email (sha256): ${fingerprint(key.clientEmail)}`);
    console.log('Registra ambas huellas en config/gsc-expected-service-account.json.');
    return 0;
  }

  const identity = checkIdentity(key, await loadExpectedIdentity());
  if (!identity.ok) abort(`${identity.reason}. No se ha hecho ninguna llamada.`);

  const window = windowFor();
  console.log(`Identidad verificada (proyecto y cuenta de servicio esperados; valores no mostrados).`);
  console.log(`Ventana: ${window.startDate} → ${window.endDate} (${WINDOW_DAYS} días, datos finales).`);
  console.log(`Propiedades: ${PROPERTIES.map((p) => `${p.brand} = ${p.siteUrl}`).join(' · ')}`);
  if (mode === '--check') { console.log('Modo --check: no se ha hecho ninguna llamada de red.'); return 0; }

  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ credentials: key.credentials, scopes: [SCOPE] });
  const webmasters = google.webmasters({ version: 'v3', auth });

  let failed = 0;
  for (const property of PROPERTIES) {
    try {
      const { data } = await webmasters.searchanalytics.query({
        siteUrl: property.siteUrl,
        requestBody: { startDate: window.startDate, endDate: window.endDate, dataState: 'final' },
      });
      console.log(formatRow(property.brand, data, window));
    } catch (error) {
      failed += 1;
      console.log(`${property.brand}: error de Search Console (${describeError(error)}).`);
    }
  }
  console.log(failed === 0 ? 'Prueba completada. Borra el archivo JSON local fuera del proyecto.' : `${failed} propiedad(es) con error. Borra el archivo JSON local fuera del proyecto.`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      if (err instanceof AbortRun) console.error(err.message);
      else console.error(`Error inesperado (${describeError(err)}). No se muestran detalles.`);
      process.exitCode = 1;
    });
}
