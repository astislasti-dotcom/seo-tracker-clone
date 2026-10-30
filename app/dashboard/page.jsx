'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import './dashboard.css';
import { buildDashboardModel, DISPLAY, summarizeKeywords } from '../../lib/keywords/measurements.mjs';
import { brandLabel, formatMeasurementDate, measurementSubtitle } from '../../lib/keywords/labels.mjs';
import { HISTORY_ORDER, readAllRows } from '../../lib/keywords/paginate.mjs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const LOADING_MODEL = {
  status: 'loading',
  keywords: [],
  counts: null,
  averagePosition: null,
  lastMeasuredAt: null,
};

// Complete history, read page by page. The exact total is requested so that a silent
// server-side row cap is detected and reported instead of showing partial data.
const fetchHistoryPage = async (from, to) => {
  let query = supabase.from('keyword_tracking').select('*', { count: 'exact' });
  // Unique, stable order (ends with the primary key) so offset pages never overlap or skip.
  for (const column of HISTORY_ORDER) {
    query = query.order(column, { ascending: true });
  }
  const { data, error, count } = await query.range(from, to);
  return { data, error, count };
};

const BRANDS = [
  { id: 'all', label: 'Todas', name: 'Todas las marcas' },
  { id: '3av.events', label: '3AV', name: '3AV Events' },
  { id: 'astisl.es', label: 'ASTI', name: 'ASTI' },
];

const STATUS_MESSAGES = {
  measurements_error: 'No se pudieron cargar las mediciones. Las cifras no se muestran hasta recuperar datos verificados.',
  measurements_incomplete: 'La lectura de mediciones está incompleta: no se han recibido todas las filas. Las cifras no se muestran para evitar resultados parciales.',
};

function positionCell(kw) {
  if (kw.state === DISPLAY.RANKED) {
    return { value: `#${kw.position}`, note: `Medición verificada · ${formatMeasurementDate(kw.measured_at) ?? ''}`, state: 'ranked' };
  }
  if (kw.state === DISPLAY.NOT_FOUND) {
    return { value: 'No aparece', note: `Medición verificada · ${formatMeasurementDate(kw.measured_at) ?? ''}`, state: 'none' };
  }
  if (kw.state === DISPLAY.UNKNOWN) {
    return { value: '—', note: 'No disponible por error de lectura', state: 'none' };
  }
  return { value: '—', note: 'Sin medición verificada', state: 'none' };
}

/* ---------- Icons (inline SVG, no emoji) ---------- */

function Icon({ children, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const IconPanel = () => (
  <Icon>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Icon>
);

const IconReports = () => (
  <Icon>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5" />
    <path d="M10 13h6M10 17h6" />
  </Icon>
);

const IconSearch = () => (
  <Icon size={16}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);

const IconAlert = () => (
  <Icon>
    <path d="M12 4 2.8 20h18.4z" />
    <path d="M12 10v4M12 17.5v.5" />
  </Icon>
);

const IconEmpty = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M4 10h16" />
  </Icon>
);

const IconMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M4 19V11M10 19V5M16 19v-6M22 19H2" />
  </svg>
);

/* ---------- Small components ---------- */

function KpiCard({ label, value, note, empty }) {
  return (
    <div className="sd-card sd-kpi">
      <div className="sd-kpi-label">{label}</div>
      <div className="sd-kpi-value" data-empty={empty ? 'true' : 'false'}>
        {value}
      </div>
      <div className="sd-kpi-note">{note}</div>
    </div>
  );
}

function StateCard({ icon, title, text, action }) {
  return (
    <div className="sd-state" role="status">
      <div className="sd-state-icon">{icon}</div>
      <p className="sd-state-title">{title}</p>
      {text && <p className="sd-state-text">{text}</p>}
      {action}
    </div>
  );
}

function SkeletonRows() {
  return Array.from({ length: 5 }, (_, i) => (
    <tr key={i} aria-hidden="true">
      <td><span className="sd-skeleton" style={{ width: '60%' }} /></td>
      <td className="sd-col-intent"><span className="sd-skeleton" style={{ width: '50%' }} /></td>
      <td className="sd-col-intent"><span className="sd-skeleton" style={{ width: '40%' }} /></td>
      <td className="sd-col-priority"><span className="sd-skeleton" style={{ width: '30%' }} /></td>
      <td className="sd-num"><span className="sd-skeleton" style={{ width: '50%', marginLeft: 'auto' }} /></td>
    </tr>
  ));
}

/* ---------- Page ---------- */

export default function Dashboard() {
  const [model, setModel] = useState(LOADING_MODEL);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState('overview');
  const [brand, setBrand] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let catalogRaw;
      try {
        const response = await fetch('/keywords.json');
        if (!response.ok) throw new Error('catalog_http_error');
        catalogRaw = await response.json();
      } catch {
        if (!cancelled) setModel(buildDashboardModel({ catalogRaw: null, read: null }));
        return;
      }

      const read = await readAllRows(fetchHistoryPage);
      if (!read.ok) console.error('keyword_tracking read incomplete or failed:', read.reason);
      if (!cancelled) setModel(buildDashboardModel({ catalogRaw, read }));
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setModel(LOADING_MODEL);
    setAttempt((n) => n + 1);
  };

  const loading = model.status === 'loading';
  const brandInfo = BRANDS.find((b) => b.id === brand);
  const visible = model.keywords.filter((kw) => brand === 'all' || kw.domain === brand);
  const summary = model.status === 'ok' ? summarizeKeywords(visible) : null;
  const counts = summary?.counts ?? null;
  // Date and scope come from the visible brand only, never from the global model.
  const subtitle = measurementSubtitle({
    status: model.status,
    lastMeasuredAt: summary?.lastMeasuredAt ?? null,
    brand,
  });
  const normalizedQuery = query.trim().toLowerCase();
  const rows = visible.filter((kw) => !normalizedQuery || kw.keyword.toLowerCase().includes(normalizedQuery));

  const dash = '—';
  const noReliable = 'Sin datos fiables en esta carga';
  const kpis = [
    {
      label: 'Keywords',
      value: loading || !counts ? dash : counts.total,
      note: loading ? 'Cargando…' : !counts ? noReliable : brandInfo.name,
      empty: loading || !counts,
    },
    {
      label: 'Con medición verificada',
      value: loading || !counts ? dash : counts.ranked + counts.notFound,
      note: loading ? 'Cargando…' : !counts ? noReliable : `${counts.ranked} posicionadas · ${counts.notFound} sin aparecer`,
      empty: loading || !counts,
    },
    {
      label: 'Top 10 verificadas',
      value: loading || !counts || counts.top10 === null ? dash : counts.top10,
      note: loading ? 'Cargando…' : !counts ? noReliable : counts.ranked === 0 ? 'Sin posiciones verificadas todavía' : `De ${counts.ranked} posicionadas`,
      empty: loading || !counts || counts.top10 === null,
    },
    {
      label: 'Posición media',
      value: loading || !summary || summary.averagePosition === null ? dash : summary.averagePosition.toFixed(1),
      note: loading ? 'Cargando…' : !counts ? noReliable : counts.ranked === 0 ? 'Sin posiciones verificadas todavía' : `Sobre ${counts.ranked} posiciones verificadas`,
      empty: loading || !summary || summary.averagePosition === null,
    },
  ];

  const measurementBanner = STATUS_MESSAGES[model.status];

  let tableArea;
  if (model.status === 'catalog_error') {
    tableArea = (
      <StateCard
        icon={<IconAlert />}
        title="No se pudo cargar el catálogo de keywords"
        text="Revisa la conexión y vuelve a intentarlo. No se muestran datos hasta que el catálogo esté disponible."
        action={<button type="button" className="sd-button" onClick={retry}>Reintentar</button>}
      />
    );
  } else if (!loading && model.status === 'empty') {
    tableArea = (
      <StateCard
        icon={<IconEmpty />}
        title="Todavía no hay keywords configuradas"
        text="Añade keywords al catálogo para empezar a medir su posición."
      />
    );
  } else if (!loading && visible.length === 0) {
    tableArea = (
      <StateCard icon={<IconEmpty />} title="Esta marca no tiene keywords en el catálogo" text="Selecciona otra marca o añade keywords al catálogo." />
    );
  } else if (!loading && rows.length === 0) {
    tableArea = (
      <StateCard icon={<IconSearch />} title="Ninguna keyword coincide con la búsqueda" text="Prueba con otro término o borra el filtro." />
    );
  } else {
    tableArea = (
      <div className="sd-table-wrap">
        <table className="sd-table">
          <thead>
            <tr>
              <th scope="col">Keyword</th>
              <th scope="col" className="sd-col-brand">Marca</th>
              <th scope="col" className="sd-col-intent">Intención</th>
              <th scope="col" className="sd-col-priority">Prioridad</th>
              <th scope="col" className="sd-num">Posición</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? <SkeletonRows />
              : rows.map((kw) => {
                  const pos = positionCell(kw);
                  return (
                    <tr key={kw.key}>
                      <td>
                        <span className="sd-keyword">{kw.keyword}</span>
                        <span className="sd-pill sd-brand-inline">{brandLabel(kw.domain)}</span>
                      </td>
                      <td className="sd-col-brand"><span className="sd-pill">{brandLabel(kw.domain)}</span></td>
                      <td className="sd-col-intent sd-muted">{kw.intent}</td>
                      <td className="sd-col-priority"><span className="sd-pill" data-priority={kw.priority}>{kw.priority}</span></td>
                      <td className="sd-num">
                        <div className="sd-position" data-state={pos.state}>{pos.value}</div>
                        <span className="sd-status">{pos.note}</span>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="sd-root" data-brand={brand}>
      <div className="sd-shell">
        <aside className="sd-sidebar" aria-label="Navegación principal">
          <div className="sd-brand">
            <div className="sd-brand-mark"><IconMark /></div>
            <div className="sd-brand-name">SEO Tracker</div>
          </div>
          <nav className="sd-nav">
            <button type="button" className="sd-nav-item" aria-current={view === 'overview' ? 'page' : undefined} onClick={() => setView('overview')}>
              <IconPanel /> Panel
            </button>
            <button type="button" className="sd-nav-item" aria-current={view === 'reports' ? 'page' : undefined} onClick={() => setView('reports')}>
              <IconReports /> Reportes
            </button>
          </nav>
          <div className="sd-sidebar-foot">{subtitle}</div>
        </aside>

        <main className="sd-main">
          <div className="sd-content">
            <header className="sd-header">
              <div>
                <h1 className="sd-title">Control SEO</h1>
                <p className="sd-subtitle">{subtitle}</p>
              </div>
              {view === 'overview' && (
                <div className="sd-segmented" role="group" aria-label="Filtrar por marca">
                  {BRANDS.map((b) => (
                    <button key={b.id} type="button" aria-pressed={brand === b.id} onClick={() => setBrand(b.id)}>
                      {b.label}
                    </button>
                  ))}
                </div>
              )}
            </header>

            {measurementBanner && view === 'overview' && (
              <div className="sd-banner" data-tone="error" role="alert">
                <div className="sd-banner-body">{measurementBanner}</div>
                <button type="button" className="sd-button" style={{ marginTop: 0 }} onClick={retry}>Reintentar</button>
              </div>
            )}

            {view === 'reports' && (
              <section className="sd-card">
                <StateCard
                  icon={<IconReports />}
                  title="Reportes en preparación"
                  text="Los reportes semanales y mensuales estarán disponibles próximamente."
                />
              </section>
            )}

            {view === 'overview' && (
              <>
                <section className="sd-kpis" aria-label="Resumen">
                  {kpis.map((k) => (
                    <KpiCard key={k.label} label={k.label} value={k.value} note={k.note} empty={k.empty} />
                  ))}
                </section>

                <section className="sd-card" aria-labelledby="sd-keywords-title">
                  <div className="sd-section-head">
                    <div>
                      <h2 id="sd-keywords-title" className="sd-section-title">Keywords</h2>
                      <p className="sd-section-meta">
                        {loading ? 'Cargando…' : `Mostrando ${rows.length} de ${visible.length}`}
                      </p>
                    </div>
                    <label className="sd-search">
                      <IconSearch />
                      <span className="sd-sr-only">Buscar keyword</span>
                      <input
                        type="search"
                        placeholder="Buscar keyword"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={loading || model.keywords.length === 0}
                      />
                    </label>
                  </div>
                  {tableArea}
                </section>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
