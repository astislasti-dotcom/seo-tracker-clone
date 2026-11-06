// GSC-06E · arnés LOCAL de verificación. Datos ficticios; transporte simulado; no es una ruta de la app.
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapshotsSection } from '../../app/dashboard/snapshots-section.mjs';
import { demoResponse } from '../../tests/fixtures/gsc-snapshots-demo.mjs';

const mode = new URLSearchParams(location.search).get('mode') ?? 'normal';

// Transporte simulado. mode=race: la consulta de 7 días tarda más, para probar respuestas obsoletas.
function fakeFetcher(url, init) {
  const u = new URL(url, location.href);
  const domain = u.searchParams.get('brand');
  const dimension = u.searchParams.get('dimension');
  const period = Number(u.searchParams.get('period'));
  const offset = Number(u.searchParams.get('offset'));
  window.__requests = [...(window.__requests ?? []), { domain, dimension, period, offset, auth: init?.headers?.Authorization ?? null }];
  if (mode === 'expired') return Promise.resolve({ status: 401, body: null });
  const delay = mode === 'race' && dimension === 'query' && period === 7 ? 1500 : 150;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(demoResponse(domain, dimension, period, offset)), delay);
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

const getToken = async () => (mode === 'nosession' ? null : 'demo-token-ficticio');

function App() {
  const [brand, setBrand] = useState('all');
  const brands = [
    ['all', 'Todas'],
    ['3av.events', '3AV'],
    ['astisl.es', 'ASTI'],
  ];
  return h(
    'div',
    { className: 'sd-root', 'data-brand': brand },
    h(
      'div',
      { className: 'sd-shell' },
      h(
        'aside',
        { className: 'sd-sidebar', 'aria-label': 'Navegación principal' },
        h('div', { className: 'sd-brand' }, h('div', { className: 'sd-brand-name' }, 'SEO Tracker')),
        h(
          'nav',
          { className: 'sd-nav' },
          h('button', { type: 'button', className: 'sd-nav-item' }, 'Panel'),
          h('button', { type: 'button', className: 'sd-nav-item', 'aria-current': 'page' }, 'Consultas y páginas'),
          h('button', { type: 'button', className: 'sd-nav-item' }, 'Reportes')
        )
      ),
      h(
        'main',
        { className: 'sd-main' },
        h(
          'div',
          { className: 'sd-content' },
          h(
            'header',
            { className: 'sd-header' },
            h('div', null, h('h1', { className: 'sd-title' }, 'Control SEO'), h('p', { className: 'sd-subtitle' }, 'Verificación local · datos ficticios')),
            h(
              'div',
              { className: 'sd-segmented', role: 'group', 'aria-label': 'Filtrar por marca' },
              brands.map(([id, label]) =>
                h('button', { key: id, type: 'button', 'aria-pressed': brand === id ? 'true' : 'false', onClick: () => setBrand(id) }, label)
              )
            )
          ),
          h(SnapshotsSection, { brand, getToken, fetcher: fakeFetcher, demo: true })
        )
      )
    )
  );
}

createRoot(document.getElementById('root')).render(h(App));
