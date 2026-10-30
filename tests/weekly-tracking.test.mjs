// Offline tests for the weekly SERP engine. Adapters are fakes. No network, no
// SerpAPI, no Supabase. Fixture domains are fictional or the real brand domains
// used only as strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResponse, hostMatches, hostnameOf, STATES } from '../lib/serp-tracking/classify.mjs';
import {
  MAX_KEYWORDS_PER_RUN,
  runWeeklyTracking,
  toStorageRows,
  validateKeywords,
} from '../lib/serp-tracking/runner.mjs';

const organic = (link, position) => ({ link, position });
const FIXED_NOW = () => new Date('2026-11-02T06:00:00.000Z');

// ---------- classification ----------

test('hostname: se normaliza www y mayúsculas; links inválidos no producen host', () => {
  assert.equal(hostnameOf('https://WWW.Astisl.es/servicios'), 'astisl.es');
  assert.equal(hostnameOf('not a url'), null);
  assert.equal(hostnameOf(undefined), null);
});

test('coincidencia: exacta o subdominio real; nunca por subcadena', () => {
  assert.equal(hostMatches('astisl.es', 'astisl.es'), true);
  assert.equal(hostMatches('blog.astisl.es', 'astisl.es'), true);
  assert.equal(hostMatches('evilastisl.es', 'astisl.es'), false);
  assert.equal(hostMatches('astisl.es.example.net', 'astisl.es'), false);
  assert.equal(hostMatches('example.com', '3av.events'), false);
});

test('ranked: usa la posición que informa el proveedor', () => {
  const r = classifyResponse({
    response: { organic_results: [organic('https://other.example/a', 1), organic('https://3av.events/eventos', 2)] },
    targetDomain: '3av.events',
  });
  assert.equal(r.state, STATES.RANKED);
  assert.equal(r.position, 2);
  assert.equal(r.resultsReturned, 2);
});

test('ranked: con varias coincidencias gana la posición más baja', () => {
  const r = classifyResponse({
    response: { organic_results: [organic('https://astisl.es/b', 7), organic('https://astisl.es/a', 3)] },
    targetDomain: 'astisl.es',
  });
  assert.equal(r.position, 3);
});

test('not_found: sin coincidencias, posición nula y alcance conocido', () => {
  const r = classifyResponse({
    response: { organic_results: [organic('https://other.example/a', 1)] },
    targetDomain: 'astisl.es',
  });
  assert.deepEqual(r, { state: STATES.NOT_FOUND, position: null, resultsReturned: 1 });
});

test('not_found: el mensaje "sin resultados" del proveedor es un no-resultado, no un fallo', () => {
  const r = classifyResponse({
    response: { error: "Google hasn't returned any results for this query." },
    targetDomain: 'astisl.es',
  });
  assert.deepEqual(r, { state: STATES.NOT_FOUND, position: null, resultsReturned: 0 });
});

test('error: fallo del proveedor, respuesta malformada o posición ausente nunca son 0', () => {
  const cases = [
    [{ error: 'Invalid API key.' }, 'provider_error'],
    [null, 'malformed_response'],
    [[], 'malformed_response'],
    [{ search_metadata: {} }, 'malformed_response'],
    [{ organic_results: [{ link: 'https://astisl.es/x' }] }, 'position_missing'],
    [{ organic_results: [{ link: 'https://astisl.es/x', position: 0 }] }, 'position_missing'],
  ];
  for (const [response, reason] of cases) {
    const r = classifyResponse({ response, targetDomain: 'astisl.es' });
    assert.equal(r.state, STATES.ERROR, `reason=${reason}`);
    assert.equal(r.position, null);
    assert.equal(r.reason, reason);
  }
});

test('error: dominio objetivo fuera de la lista permitida', () => {
  const r = classifyResponse({ response: { organic_results: [] }, targetDomain: 'example.com' });
  assert.equal(r.state, STATES.ERROR);
  assert.equal(r.reason, 'invalid_target_domain');
});

// ---------- input validation ----------

test('validación: marcas separadas, duplicados y entradas inválidas se omiten sin llamar a nada', () => {
  const { valid, skipped, tooMany, invalidInput } = validateKeywords([
    { id: 1, keyword: 'Interpretación simultánea', domain: 'astisl.es' },
    { id: 2, keyword: 'interpretación simultánea ', domain: 'astisl.es' }, // duplicado
    { id: 3, keyword: 'interpretación simultánea', domain: '3av.events' }, // otra marca: válido
    { id: 4, keyword: '', domain: 'astisl.es' }, // vacío
    { id: 5, keyword: 'algo', domain: 'competidor.example' }, // dominio no permitido
    { id: null, keyword: 'sin id', domain: 'astisl.es' },
  ]);
  assert.equal(invalidInput, false);
  assert.equal(tooMany, false);
  assert.deepEqual(valid.map((k) => k.id), [1, 3]);
  assert.equal(skipped, 4);
});

test('validación: entrada que no es lista se rechaza', () => {
  assert.equal(validateKeywords('no-es-lista').invalidInput, true);
});

test('validación: el conjunto real de 31 keywords cabe en el tope', () => {
  const list = Array.from({ length: 31 }, (_, i) => ({
    id: i + 1,
    keyword: `kw ${i}`,
    domain: i % 2 === 0 ? '3av.events' : 'astisl.es',
  }));
  const { valid, tooMany } = validateKeywords(list);
  assert.equal(valid.length, MAX_KEYWORDS_PER_RUN);
  assert.equal(tooMany, false);
});

// ---------- runner ----------

test('runner: más de 31 keywords se rechaza sin ninguna búsqueda', async () => {
  let calls = 0;
  const list = Array.from({ length: 32 }, (_, i) => ({ id: i + 1, keyword: `kw ${i}`, domain: 'astisl.es' }));
  const result = await runWeeklyTracking({
    keywords: list,
    search: async () => ((calls++), { organic_results: [] }),
    now: FIXED_NOW,
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'too_many_keywords');
  assert.equal(calls, 0);
});

test('runner: una búsqueda por keyword, sin reintentos, y clasificación correcta', async () => {
  const seen = [];
  const responses = {
    'kw ranked': { organic_results: [organic('https://astisl.es/x', 4)] },
    'kw none': { organic_results: [organic('https://other.example/', 1)] },
  };
  const keywords = [
    { id: 10, keyword: 'kw ranked', domain: 'astisl.es' },
    { id: 11, keyword: 'kw none', domain: 'astisl.es' },
  ];
  const result = await runWeeklyTracking({
    keywords,
    search: async (kw) => (seen.push(kw.keyword), responses[kw.keyword]),
    now: FIXED_NOW,
  });
  assert.deepEqual(seen, ['kw ranked', 'kw none']);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.counters, { attempted: 2, ranked: 1, not_found: 1, failed: 0, saved: 0, skipped: 0 });
  assert.equal(result.persistence, 'none');
  assert.equal(result.measured_at, '2026-11-02T06:00:00.000Z');
});

test('runner: excepción del proveedor = error, no posición 0, y no se persiste', async () => {
  const persisted = [];
  const keywords = [
    { id: 1, keyword: 'falla', domain: 'astisl.es' },
    { id: 2, keyword: 'ok', domain: 'astisl.es' },
  ];
  const result = await runWeeklyTracking({
    keywords,
    search: async (kw) => {
      if (kw.keyword === 'falla') throw new Error('timeout con clave=SECRETO-NO-DEBE-SALIR');
      return { organic_results: [organic('https://astisl.es/', 2)] };
    },
    persist: async (rows) => persisted.push(...rows),
    now: FIXED_NOW,
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.counters.failed, 1);
  assert.equal(result.counters.ranked, 1);
  assert.equal(result.counters.saved, 1);

  const failedItem = result.items.find((i) => i.keyword === 'falla');
  assert.equal(failedItem.state, STATES.ERROR);
  assert.equal(failedItem.position, null);
  assert.equal(failedItem.reason, 'request_failed');
  // El texto de la excepción no se conserva en el resultado.
  assert.ok(!JSON.stringify(result).includes('SECRETO-NO-DEBE-SALIR'));

  // Solo la medición real llega a persistencia; el error nunca se escribe como 0.
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].keyword_id, 2);
  assert.equal(persisted.some((row) => row.keyword_id === 1), false);
});

test('runner: not_found se persiste con posición nula, nunca 0', async () => {
  const persisted = [];
  await runWeeklyTracking({
    keywords: [{ id: 7, keyword: 'sin ranking', domain: '3av.events' }],
    search: async () => ({ organic_results: [organic('https://other.example/', 1)] }),
    persist: async (rows) => persisted.push(...rows),
    now: FIXED_NOW,
  });
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].state, STATES.NOT_FOUND);
  assert.equal(persisted[0].position, null);
});

test('runner: fallo de persistencia = partial y saved 0; nunca se declara éxito', async () => {
  const result = await runWeeklyTracking({
    keywords: [{ id: 1, keyword: 'ok', domain: 'astisl.es' }],
    search: async () => ({ organic_results: [organic('https://astisl.es/', 1)] }),
    persist: async () => {
      throw new Error('db down');
    },
    now: FIXED_NOW,
  });
  assert.equal(result.persistence, 'failed');
  assert.equal(result.status, 'partial');
  assert.equal(result.counters.saved, 0);
});

test('runner: search no es función = error de programación explícito', async () => {
  await assert.rejects(() => runWeeklyTracking({ keywords: [], search: null }), TypeError);
});

test('toStorageRows: excluye errores y nunca mapea posición 0', () => {
  const rows = toStorageRows(
    [
      { id: 1, domain: 'astisl.es', state: STATES.ERROR, position: null },
      { id: 2, domain: 'astisl.es', state: STATES.NOT_FOUND, position: null },
      { id: 3, domain: 'astisl.es', state: STATES.RANKED, position: 5 },
    ],
    'x'
  );
  assert.deepEqual(rows.map((r) => r.keyword_id), [2, 3]);
  assert.ok(rows.every((r) => r.position !== 0));
});
