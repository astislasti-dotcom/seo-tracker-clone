// GSC-06E · sección «Consultas y páginas». Sin JSX: createElement permite probarla en Node.
// SnapshotsView es presentacional (recibe datos ya resueltos). SnapshotsSection pide datos a
// /api/gsc/snapshots con el token de sesión del propietario. Ningún dato sale de Google ni de
// Supabase directamente desde el navegador.
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { brandLabel } from '../../lib/keywords/labels.mjs';
import {
  SNAPSHOT_BRANDS,
  SNAPSHOT_PAGE_SIZE,
  SNAPSHOT_DIMENSIONS,
  SNAPSHOT_NOTICE,
  SNAPSHOT_PERIODS,
  SNAPSHOT_TRUNCATED_NOTICE,
  buildSnapshotUrl,
  classifyResponse,
  createRequestGate,
  formatCaptureStart,
  formatCount,
  formatCtr,
  formatPosition,
  formatWindow,
  groupsFor,
  messageFor,
  paginationFor,
  safePageLink,
} from '../../lib/gsc/snapshot-ui.mjs';

const DIMENSION_LABEL = Object.freeze({ query: 'Consultas', page: 'Páginas' });
const KEY_HEADER = Object.freeze({ query: 'Consulta', page: 'URL' });

// Resultado visible por propiedad. Cada tipo tiene su propio texto; nunca se rellena con ceros.
function ResultBody({ result, dimension, pager }) {
  const kind = result?.kind ?? 'loading';
  if (kind === 'loading') return h('p', { className: 'sd-muted', role: 'status' }, messageFor('loading'));
  if (kind === 'unauthorized') return h('p', { className: 'sd-banner', role: 'alert' }, messageFor('unauthorized'));
  if (kind === 'forbidden') return h('p', { className: 'sd-banner', role: 'alert' }, messageFor('forbidden'));
  if (kind === 'missing') return h('p', { className: 'sd-muted' }, messageFor('missing'));
  if (kind === 'invalid') return h('p', { className: 'sd-banner', role: 'alert' }, messageFor('invalid'));
  if (kind === 'error') return h('p', { className: 'sd-banner', role: 'alert' }, messageFor('error'));
  if (kind === 'emptySnapshot') return h('p', { className: 'sd-muted' }, messageFor('emptySnapshot'));

  const snapshot = result.snapshot;
  const table =
    kind === 'emptyPage'
      ? h('p', { className: 'sd-muted' }, messageFor('emptyPage'))
      : h(
          'div',
          { className: 'sd-table-wrap' },
          h(
            'table',
            { className: 'sd-table sd-snap-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { scope: 'col' }, KEY_HEADER[dimension]),
                h('th', { scope: 'col', className: 'sd-num' }, 'Clics'),
                h('th', { scope: 'col', className: 'sd-num' }, 'Impresiones'),
                h('th', { scope: 'col', className: 'sd-num' }, 'CTR'),
                h('th', { scope: 'col', className: 'sd-num' }, 'Posición media GSC')
              )
            ),
            h(
              'tbody',
              null,
              snapshot.rows.map((row) => {
                const href = dimension === 'page' ? safePageLink(row.key) : null;
                // El texto se muestra exacto. React lo escapa; nunca se usa innerHTML.
                const keyCell = href
                  ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, row.key)
                  : h('span', { className: 'sd-snap-key' }, row.key);
                return h(
                  'tr',
                  { key: row.key },
                  h('td', { className: 'sd-snap-keycell' }, keyCell),
                  h('td', { className: 'sd-num' }, formatCount(row.clicks)),
                  h('td', { className: 'sd-num' }, formatCount(row.impressions)),
                  h('td', { className: 'sd-num' }, formatCtr(row.ctr)),
                  h('td', { className: 'sd-num' }, formatPosition(row.position))
                );
              })
            )
          )
        );

  const first = snapshot.offset + 1;
  const last = snapshot.offset + snapshot.returned;
  return h(
    'div',
    null,
    table,
    h(
      'nav',
      { className: 'sd-snap-pager', 'aria-label': `Paginación de ${DIMENSION_LABEL[dimension].toLowerCase()}` },
      h('span', { className: 'sd-muted' }, `Mostrando ${formatCount(first)}–${formatCount(last)} de ${formatCount(snapshot.totalAvailable)} · página ${pager.page} de ${pager.pages}`),
      h(
        'span',
        { className: 'sd-snap-pager-buttons' },
        h('button', { type: 'button', className: 'sd-button', disabled: !pager.hasPrev, onClick: pager.onPrev }, 'Anterior'),
        h('button', { type: 'button', className: 'sd-button', disabled: !pager.hasNext, onClick: pager.onNext }, 'Siguiente')
      )
    )
  );
}

function GroupCard({ group, dimension, demo }) {
  const { label, result, offset, onPrev, onNext } = group;
  const snapshot = result?.snapshot;
  const pager = paginationFor(snapshot, offset);
  const truncated = snapshot?.truncatedAtSource === true;
  return h(
    'section',
    { className: 'sd-card', 'aria-labelledby': `sd-snap-${group.domain}-title` },
    h(
      'div',
      { className: 'sd-section-head' },
      h(
        'div',
        null,
        h('h2', { id: `sd-snap-${group.domain}-title`, className: 'sd-section-title' }, `${label} · ${DIMENSION_LABEL[dimension]}`),
        h(
          'p',
          { className: 'sd-section-meta' },
          snapshot
            ? `Ventana ${formatWindow(snapshot.window)} · inicio de captura ${formatCaptureStart(snapshot.requestedAt)}`
            : 'Sin captura cargada'
        )
      ),
      demo ? h('span', { className: 'sd-pill sd-snap-demo' }, 'DEMO · datos ficticios') : null
    ),
    h('p', { className: 'sd-snap-notice' }, SNAPSHOT_NOTICE),
    truncated ? h('p', { className: 'sd-banner', role: 'note' }, SNAPSHOT_TRUNCATED_NOTICE) : null,
    h(ResultBody, { result, dimension, pager: { ...pager, onPrev, onNext } })
  );
}

// Vista pura. Recibe datos ya resueltos por el contenedor o por una prueba.
export function SnapshotsView({ brand, dimension, period, groups, demo = false, onDimension, onPeriod, onBrand }) {
  return h(
    'div',
    { className: 'sd-snap' },
    h(
      'div',
      { className: 'sd-snap-controls' },
      h(
        'div',
        { className: 'sd-segmented', role: 'tablist', 'aria-label': 'Dimensión' },
        SNAPSHOT_DIMENSIONS.map((d) =>
          h(
            'button',
            {
              key: d,
              type: 'button',
              role: 'tab',
              'aria-selected': dimension === d ? 'true' : 'false',
              onClick: () => onDimension(d),
            },
            DIMENSION_LABEL[d]
          )
        )
      ),
      h(
        'div',
        { className: 'sd-segmented', role: 'group', 'aria-label': 'Periodo' },
        SNAPSHOT_PERIODS.map((p) =>
          h('button', { key: p, type: 'button', 'aria-pressed': period === p ? 'true' : 'false', onClick: () => onPeriod(p) }, `${p} días`)
        )
      ),
      onBrand
        ? h(
            'div',
            { className: 'sd-segmented', role: 'group', 'aria-label': 'Filtrar por marca' },
            SNAPSHOT_BRANDS.map((b) =>
              h('button', { key: b.id, type: 'button', 'aria-pressed': brand === b.id ? 'true' : 'false', onClick: () => onBrand(b.id) }, b.label)
            )
          )
        : null
    ),
    groups.map((group) => h(GroupCard, { key: group.domain, group, dimension, demo }))
  );
}

async function defaultFetcher(url, init) {
  const response = await fetch(url, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function fetchGroup({ domain, dimension, period, offset, token, fetcher, signal }) {
  const url = buildSnapshotUrl({ domain, dimension, period, offset });
  if (!url) return { kind: 'invalid' };
  if (!token) return { kind: 'unauthorized' };
  let response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
  } catch {
    if (signal.aborted) return null;
    return { kind: 'error' };
  }
  return classifyResponse({ status: response.status, body: response.body, expected: { domain, dimension, period } });
}

// Contenedor con estado. `getToken` devuelve el token de sesión o null. `fetcher` se inyecta en pruebas.
// Los resultados llevan la clave de su petición (ámbito + desplazamientos). Si la clave no coincide
// con la actual, la propiedad se muestra como «cargando»: nunca se pinta un resultado obsoleto.
export function SnapshotsSection({ brand, getToken, fetcher = defaultFetcher, demo = false }) {
  const [dimension, setDimension] = useState('query');
  const [period, setPeriod] = useState(28);
  const [offsetState, setOffsetState] = useState({ scope: null, offsets: {} });
  const [resultState, setResultState] = useState({ key: null, byDomain: {} });
  const getTokenRef = useRef(getToken);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    getTokenRef.current = getToken;
    fetcherRef.current = fetcher;
  }, [getToken, fetcher]);

  const scope = `${brand}|${dimension}|${period}`;
  // Los desplazamientos solo valen para el ámbito en el que se pidieron.
  const offsets = useMemo(
    () => (offsetState.scope === scope ? offsetState.offsets : {}),
    [offsetState, scope]
  );
  const offsetsKey = JSON.stringify(groupsFor(brand).map((domain) => [domain, offsets[domain] ?? 0]));
  const requestKey = `${scope}|${offsetsKey}`;

  useEffect(() => {
    const groups = groupsFor(brand);
    const gate = createRequestGate();
    const requestId = gate.next();
    const controller = new AbortController();

    (async () => {
      let token = null;
      try {
        token = await getTokenRef.current();
      } catch {
        token = null;
      }
      await Promise.all(
        groups.map(async (domain) => {
          const result = await fetchGroup({
            domain,
            dimension,
            period,
            offset: offsets[domain] ?? 0,
            token,
            fetcher: fetcherRef.current,
            signal: controller.signal,
          });
          if (result === null || controller.signal.aborted || !gate.isCurrent(requestId)) return;
          setResultState((prev) => ({
            key: requestKey,
            byDomain: { ...(prev.key === requestKey ? prev.byDomain : {}), [domain]: result },
          }));
        })
      );
    })();

    return () => controller.abort();
  }, [brand, dimension, period, offsets, requestKey]);

  const byDomain = resultState.key === requestKey ? resultState.byDomain : {};
  const groups = groupsFor(brand).map((domain) => {
    const offset = offsets[domain] ?? 0;
    const move = (next) => setOffsetState({ scope, offsets: { ...offsets, [domain]: next } });
    return {
      domain,
      label: brandLabel(domain),
      result: byDomain[domain] ?? { kind: 'loading' },
      offset,
      onPrev: () => move(Math.max(0, offset - SNAPSHOT_PAGE_SIZE)),
      onNext: () => move(offset + SNAPSHOT_PAGE_SIZE),
    };
  });

  return h(SnapshotsView, {
    brand,
    dimension,
    period,
    groups,
    demo,
    onDimension: setDimension,
    onPeriod: setPeriod,
  });
}
