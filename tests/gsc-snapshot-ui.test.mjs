// GSC-06E · pruebas offline de la vista «Consultas y páginas». Datos ficticios, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  groupsFor,
  buildSnapshotUrl,
  classifyResponse,
  safePageLink,
  paginationFor,
  formatCount,
  formatCtr,
  formatPosition,
  formatWindow,
  formatCaptureStart,
  createRequestGate,
  messageFor,
  SNAPSHOT_PAGE_SIZE,
  SNAPSHOT_NOTICE,
} from '../lib/gsc/snapshot-ui.mjs';
import { SnapshotsView } from '../app/dashboard/snapshots-section.mjs';
import { demoResponse, DEMO_PAGES_ASTI, DEMO_QUERIES_ASTI, DEMO_QUERIES_3AV } from './fixtures/gsc-snapshots-demo.mjs';

const EXPECTED = { domain: 'astisl.es', dimension: 'query', period: 28 };

// --- 1. Propiedades y URLs --------------------------------------------------------------

test('todas las marcas generan dos grupos independientes; una marca genera uno', () => {
  assert.deepEqual(groupsFor('all'), ['astisl.es', '3av.events']);
  assert.deepEqual(groupsFor('astisl.es'), ['astisl.es']);
  assert.deepEqual(groupsFor('evil.example'), []);
});

test('la URL pide una sola propiedad, limit fijo de 100 y el offset indicado', () => {
  const url = buildSnapshotUrl({ domain: 'astisl.es', dimension: 'page', period: 90, offset: 200 });
  assert.equal(url, '/api/gsc/snapshots?brand=astisl.es&dimension=page&period=90&limit=100&offset=200');
  assert.equal(SNAPSHOT_PAGE_SIZE, 100);
  assert.equal(url.includes('brand=all'), false);
});

test('la URL rechaza marca, dimensión, periodo u offset fuera del contrato', () => {
  assert.equal(buildSnapshotUrl({ domain: 'all', dimension: 'query', period: 7 }), null);
  assert.equal(buildSnapshotUrl({ domain: 'evil.example', dimension: 'query', period: 7 }), null);
  assert.equal(buildSnapshotUrl({ domain: 'astisl.es', dimension: 'country', period: 7 }), null);
  assert.equal(buildSnapshotUrl({ domain: 'astisl.es', dimension: 'query', period: 30 }), null);
  assert.equal(buildSnapshotUrl({ domain: 'astisl.es', dimension: 'query', period: 7, offset: 5000 }), null);
  assert.equal(buildSnapshotUrl({ domain: 'astisl.es', dimension: 'query', period: 7, offset: -1 }), null);
  assert.equal(buildSnapshotUrl({ domain: 'astisl.es', dimension: 'query', period: 7, offset: 1.5 }), null);
});

// --- 2. Clasificación de respuestas -----------------------------------------------------

test('401 y 403 se clasifican como sesión caducada y acceso reservado', () => {
  assert.equal(classifyResponse({ status: 401, body: null, expected: EXPECTED }).kind, 'unauthorized');
  assert.equal(classifyResponse({ status: 403, body: null, expected: EXPECTED }).kind, 'forbidden');
});

test('cualquier otro estado de error se reduce a error sin reenviar el cuerpo', () => {
  const r = classifyResponse({ status: 502, body: { error: 'storage_error', message: 'texto crudo' }, expected: EXPECTED });
  assert.equal(r.kind, 'error');
  assert.equal(JSON.stringify(r).includes('texto crudo'), false);
});

test('200 con captura válida devuelve data; sin captura devuelve missing', () => {
  const data = demoResponse('astisl.es', 'query', 28);
  assert.equal(classifyResponse({ ...data, expected: EXPECTED }).kind, 'data');
  const missing = classifyResponse({ status: 200, body: { snapshots: [], missing: [{ domain: 'astisl.es', dimension: 'query', periodDays: 28 }] }, expected: EXPECTED });
  assert.equal(missing.kind, 'missing');
});

test('página vacía con captura y captura válida sin filas son estados distintos', () => {
  const snap = demoResponse('astisl.es', 'query', 28).body.snapshots[0];
  const emptyPage = classifyResponse({ status: 200, body: { snapshots: [{ ...snap, returned: 0, offset: 900 }], missing: [] }, expected: EXPECTED });
  assert.equal(emptyPage.kind, 'emptyPage');
  const emptySnapshot = classifyResponse({ status: 200, body: { snapshots: [{ ...snap, returned: 0, totalAvailable: 0, rows: [] }], missing: [] }, expected: EXPECTED });
  assert.equal(emptySnapshot.kind, 'emptySnapshot');
});

test('una respuesta que no coincide con lo pedido se rechaza (sin mezclar propiedades)', () => {
  const other = demoResponse('3av.events', 'query', 28).body;
  assert.equal(classifyResponse({ status: 200, body: other, expected: EXPECTED }).kind, 'invalid');
  const wrongDim = demoResponse('astisl.es', 'page', 28).body;
  assert.equal(classifyResponse({ status: 200, body: wrongDim, expected: EXPECTED }).kind, 'invalid');
  const wrongPeriod = demoResponse('astisl.es', 'query', 7).body;
  assert.equal(classifyResponse({ status: 200, body: wrongPeriod, expected: EXPECTED }).kind, 'invalid');
});

test('cuerpos mal formados o con más de una entrada no se aceptan', () => {
  assert.equal(classifyResponse({ status: 200, body: null, expected: EXPECTED }).kind, 'invalid');
  assert.equal(classifyResponse({ status: 200, body: { snapshots: 'x', missing: [] }, expected: EXPECTED }).kind, 'invalid');
  const two = {
    snapshots: [demoResponse('astisl.es', 'query', 28).body.snapshots[0]],
    missing: [{ domain: 'astisl.es', dimension: 'query', periodDays: 28 }],
  };
  assert.equal(classifyResponse({ status: 200, body: two, expected: EXPECTED }).kind, 'invalid');
});

// --- 3. Enlaces de páginas ----------------------------------------------------------------

test('solo HTTPS con host exacto astisl.es o 3av.events generan enlace', () => {
  assert.equal(safePageLink('https://astisl.es/servicios/interpretacion'), 'https://astisl.es/servicios/interpretacion');
  assert.equal(safePageLink('https://3av.events/'), 'https://3av.events/');
});

test('URLs de imitación, esquemas no HTTPS, subdominios, puertos y credenciales no generan enlace', () => {
  const rejected = [
    'http://astisl.es/',
    'javascript:alert(1)',
    'data:text/html,hola',
    'https://astisl.es.evil.example/falso',
    'https://evil.example/astisl.es',
    'https://www.3av.events/servicios',
    'https://xastisl.es/',
    'https://astisl.es:8443/puerto',
    'https://usuario:clave@astisl.es/',
    'https://astisl.es@evil.example/',
    'astisl.es/sin-esquema',
    '',
    '   ',
  ];
  for (const text of rejected) assert.equal(safePageLink(text), null, text);
  assert.equal(safePageLink('https://astisl.es/' + 'a'.repeat(2100)), null);
  assert.equal(safePageLink(null), null);
  assert.equal(safePageLink(42), null);
});

// --- 4. Paginación y formatos ---------------------------------------------------------------

test('paginación: sin página anterior en 0, siguiente según hasMore, y número de página', () => {
  const snap = { totalAvailable: 250, hasMore: true };
  const first = paginationFor(snap, 0);
  assert.equal(first.hasPrev, false);
  assert.equal(first.hasNext, true);
  assert.equal(first.page, 1);
  assert.equal(first.pages, 3);
  const last = paginationFor({ totalAvailable: 250, hasMore: false }, 200);
  assert.equal(last.hasNext, false);
  assert.equal(last.page, 3);
  assert.equal(last.prevOffset, 100);
});

test('formatos en español; un valor ausente se muestra como guion y nunca como cero', () => {
  // Convención española (CLDR): sin separador en cuatro dígitos, con punto desde cinco.
  assert.equal(formatCount(1234), '1234');
  assert.equal(formatCount(12345), '12.345');
  assert.equal(formatCount(null), '—');
  assert.equal(formatCtr(0.1234), '12,3 %');
  assert.equal(formatCtr(undefined), '—');
  assert.equal(formatPosition(3.42), '3,4');
  assert.equal(formatPosition(null), '—');
  assert.equal(formatWindow({ startDate: '2026-10-07', endDate: '2026-11-03' }), '07/10/2026 – 03/11/2026');
  assert.equal(formatWindow(null), '—');
});

test('inicio de captura en horario de Madrid, sin presentarlo como última actualización', () => {
  const text = formatCaptureStart('2026-11-04T08:00:00.000Z');
  assert.match(text, /04\/11\/2026/);
  assert.match(text, /09:00/);
  assert.match(text, /hora de Madrid/);
  assert.equal(formatCaptureStart('no es fecha'), '—');
});

test('control de respuestas obsoletas: solo la última petición puede aplicar su resultado', () => {
  const gate = createRequestGate();
  const first = gate.next();
  const second = gate.next();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test('mensajes fijos: una clave desconocida cae en el mensaje de error genérico', () => {
  assert.equal(messageFor('clave-inventada'), messageFor('error'));
  assert.match(messageFor('unauthorized'), /sesión/);
  assert.match(SNAPSHOT_NOTICE, /no representa todas las búsquedas/);
});

// --- 5. Render: marcas, enlaces, estados y escape ---------------------------------------------

function renderView(overrides = {}) {
  const groups = overrides.groups ?? [];
  return renderToStaticMarkup(
    h(SnapshotsView, {
      brand: 'all',
      dimension: 'query',
      period: 28,
      groups,
      demo: false,
      onDimension() {},
      onPeriod() {},
      ...overrides.props,
    })
  );
}

function group(domain, label, result, extra = {}) {
  return { domain, label, result, offset: 0, onPrev() {}, onNext() {}, ...extra };
}

test('ASTI y 3AV se renderizan en tarjetas separadas, sin mezclar filas', () => {
  const asti = demoResponse('astisl.es', 'query', 28).body.snapshots[0];
  const av = demoResponse('3av.events', 'query', 28).body.snapshots[0];
  const markup = renderView({
    groups: [group('astisl.es', 'ASTI', { kind: 'data', snapshot: asti }), group('3av.events', '3AV', { kind: 'data', snapshot: av })],
  });
  const sections = markup.split('<section').slice(1);
  assert.equal(sections.length, 2);
  assert.ok(sections[0].includes('ASTI · Consultas'));
  assert.ok(sections[0].includes(DEMO_QUERIES_ASTI[0].key));
  assert.equal(sections[0].includes(DEMO_QUERIES_3AV[0].key), false);
  assert.ok(sections[1].includes('3AV · Consultas'));
  assert.ok(sections[1].includes(DEMO_QUERIES_3AV[0].key));
  assert.equal(sections[1].includes(DEMO_QUERIES_ASTI[0].key), false);
});

test('la nota de no representatividad y la ventana real aparecen en cada propiedad', () => {
  const snap = demoResponse('astisl.es', 'query', 28).body.snapshots[0];
  const markup = renderView({ groups: [group('astisl.es', 'ASTI', { kind: 'data', snapshot: snap })] });
  assert.ok(markup.includes(SNAPSHOT_NOTICE));
  assert.ok(markup.includes('07/10/2026 – 03/11/2026'));
  assert.ok(markup.includes('inicio de captura'));
});

test('en páginas solo se enlazan URLs seguras; las falsas se muestran como texto', () => {
  const snap = demoResponse('astisl.es', 'page', 28).body.snapshots[0];
  const markup = renderView({
    props: { dimension: 'page' },
    groups: [group('astisl.es', 'ASTI', { kind: 'data', snapshot: snap })],
  });
  assert.equal((markup.match(/<a /g) ?? []).length, 1);
  assert.ok(markup.includes('href="https://astisl.es/servicios/interpretacion"'));
  assert.ok(markup.includes('rel="noopener noreferrer"'));
  assert.ok(markup.includes('target="_blank"'));
  assert.equal(markup.includes('evil.example/falso"'), false);
  assert.ok(markup.includes('javascript:alert(1)'));
  assert.equal(markup.includes('href="javascript'), false);
  assert.equal(markup.includes('8443/puerto"'), false);
});

test('el texto de las consultas se escapa: nunca se interpreta como HTML', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const snap = {
    ...demoResponse('astisl.es', 'query', 28).body.snapshots[0],
    rows: [{ key: malicious, clicks: 1, impressions: 10, ctr: 0.1, position: 2 }],
    totalAvailable: 1,
    returned: 1,
    hasMore: false,
  };
  const markup = renderView({ groups: [group('astisl.es', 'ASTI', { kind: 'data', snapshot: snap })] });
  assert.equal(markup.includes('<img'), false);
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('missing, error, sesión caducada y captura sin filas no muestran ceros inventados', () => {
  const markup = renderView({
    groups: [
      group('astisl.es', 'ASTI', { kind: 'missing' }),
      group('3av.events', '3AV', { kind: 'unauthorized' }, { domain: '3av.events' }),
    ],
  });
  assert.ok(markup.includes(messageFor('missing')));
  assert.ok(markup.includes(messageFor('unauthorized')));
  assert.equal(markup.includes('>0<'), false);
  assert.equal(markup.includes('Clics'), false);
});

test('captura truncada en origen muestra el aviso; una captura normal no', () => {
  const normal = demoResponse('astisl.es', 'query', 28).body.snapshots[0];
  const truncated = { ...normal, truncatedAtSource: true };
  assert.equal(renderView({ groups: [group('astisl.es', 'ASTI', { kind: 'data', snapshot: normal })] }).includes('límite de 5.000 filas'), false);
  assert.ok(renderView({ groups: [group('astisl.es', 'ASTI', { kind: 'data', snapshot: truncated })] }).includes('límite de 5.000 filas'));
});

test('la etiqueta DEMO solo aparece cuando se pasa demo', () => {
  const snap = demoResponse('astisl.es', 'query', 28).body.snapshots[0];
  const groups = [group('astisl.es', 'ASTI', { kind: 'data', snapshot: snap })];
  assert.equal(renderView({ groups }).includes('DEMO · datos ficticios'), false);
  assert.ok(renderToStaticMarkup(h(SnapshotsView, { brand: 'all', dimension: 'query', period: 28, groups, demo: true, onDimension() {}, onPeriod() {} })).includes('DEMO · datos ficticios'));
});

test('la paginación deshabilita Anterior en la primera página y Siguiente sin más filas', () => {
  const snap = demoResponse('astisl.es', 'page', 28).body.snapshots[0];
  const markup = renderView({
    props: { dimension: 'page' },
    groups: [group('astisl.es', 'ASTI', { kind: 'data', snapshot: { ...snap, rows: DEMO_PAGES_ASTI, totalAvailable: DEMO_PAGES_ASTI.length, hasMore: false, returned: DEMO_PAGES_ASTI.length, offset: 0 } })],
  });
  const prevButton = markup.match(/<button[^>]*disabled[^>]*>Anterior<\/button>/);
  const nextButton = markup.match(/<button[^>]*disabled[^>]*>Siguiente<\/button>/);
  assert.ok(prevButton, 'Anterior debe estar deshabilitado en la primera página');
  assert.ok(nextButton, 'Siguiente debe estar deshabilitado sin más filas');
});

test('página vacía con captura válida muestra el mensaje y no una tabla de ceros', () => {
  const snap = demoResponse('astisl.es', 'query', 28).body.snapshots[0];
  const markup = renderView({
    groups: [group('astisl.es', 'ASTI', { kind: 'emptyPage', snapshot: { ...snap, returned: 0, offset: 900 } })],
  });
  assert.ok(markup.includes(messageFor('emptyPage')));
  assert.equal(markup.includes('<table'), false);
});
