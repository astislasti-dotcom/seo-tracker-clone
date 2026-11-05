'use client';

// GSC-04 · Rendimiento de Search Console dentro de /dashboard. Solo lectura de
// GET /api/gsc/metrics con el token de sesión del propietario. No usa claves de servidor.
import { useEffect, useRef, useState } from 'react';
import {
  VIEW_STATES,
  buildGscView,
  chartGeometry,
  describeDay,
  formatCount,
  formatDay,
  indexAtX,
  moveIndex,
  stateFromHttp,
} from '../../lib/gsc/dashboard-view.mjs';

export const GSC_PERIODS = Object.freeze([7, 28, 90]);

const STATE_COPY = {
  [VIEW_STATES.AUTH]: {
    title: 'Inicia sesión para ver Search Console',
    text: 'La sesión puede haber caducado. Vuelve a acceder para cargar las métricas.',
    retry: false,
  },
  [VIEW_STATES.FORBIDDEN]: {
    title: 'Tu cuenta no puede ver estas métricas',
    text: 'Solo la persona responsable del panel tiene acceso a los datos de Search Console.',
    retry: false,
  },
  [VIEW_STATES.CONFIG]: {
    title: 'Falta configuración de lectura en el servidor',
    text: 'No se pueden leer las métricas almacenadas. Avisa al responsable técnico.',
    retry: true,
  },
  [VIEW_STATES.ERROR]: {
    title: 'No se pudieron cargar las métricas de Search Console',
    text: 'No se muestran cifras para no presentar datos incompletos.',
    retry: true,
  },
  [VIEW_STATES.NETWORK]: {
    title: 'Sin conexión con el servidor',
    text: 'Revisa tu conexión y vuelve a intentarlo.',
    retry: true,
  },
  [VIEW_STATES.INVALID]: {
    title: 'La respuesta no tiene el formato esperado',
    text: 'No se muestran cifras hasta recibir datos válidos.',
    retry: true,
  },
};

function KpiTile({ kpi }) {
  const empty = kpi.value === '—';
  return (
    <div className="sd-card sd-kpi sd-gsc-kpi">
      <div className="sd-kpi-label">{kpi.label}</div>
      <div className="sd-kpi-value" data-empty={empty ? 'true' : 'false'}>{kpi.value}</div>
      <div className="sd-kpi-note">{kpi.note}</div>
    </div>
  );
}

// Gráfico de línea en SVG con referencias Y, detalle del día y navegación accesible.
// · Puntero o tacto: el día más cercano se selecciona y su detalle aparece bajo el gráfico.
// · Teclado: el contenedor recibe foco; flechas, Inicio y Fin mueven el día; Escape lo quita.
// · El detalle vive en una región aria-live, así que un lector de pantalla lo anuncia.
// · Un día sin registro se dice «Sin registro», nunca 0. Un día parcial indica la marca que aporta.
function TrendChart({ series, metricKey, label, unit, tone }) {
  const geo = chartGeometry(series, metricKey);
  const [active, setActive] = useState(null);
  const plotRef = useRef(null);
  const svgRef = useRef(null);
  const n = series.length;
  const readoutId = `gsc-readout-${metricKey}`;
  const withRows = series.filter((p) => p.hasRow && p[metricKey] !== null).length;
  const partialCount = series.filter((p) => p.partial).length;
  const summary =
    `${label}: ${withRows} de ${n} días con datos, máximo ${formatCount(geo.max)}. ` +
    (partialCount > 0 ? `${partialCount} días con datos de una sola marca. ` : '') +
    'Los días sin registro aparecen como huecos.';

  const onPointer = (e) => {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vbX = ((e.clientX - rect.left) * geo.width) / rect.width;
    setActive(indexAtX(vbX, n, { width: geo.width, pad: geo.pad }));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setActive(null);
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next = moveIndex(active, e.key, n);
      if (next !== null) setActive(next);
    }
  };

  const current = active === null ? null : series[active];
  const readout = current ? describeDay(current, metricKey, unit) : null;
  const guideX = active === null ? null : geo.xs[active];
  const focusY = current && current.hasRow && typeof current[metricKey] === 'number' ? yForValue(current[metricKey], geo) : null;

  return (
    <figure className="sd-gsc-chart" data-tone={tone}>
      <figcaption className="sd-gsc-chart-title">{label}</figcaption>
      <div className="sd-gsc-plot">
        <div className="sd-gsc-yaxis" aria-hidden="true">
          {geo.ticks.map((t) => (
            <span key={t.value} style={{ top: `${(Number(t.y) / geo.height) * 100}%` }}>{t.label}</span>
          ))}
        </div>
        <div
          ref={plotRef}
          className="sd-gsc-svgwrap"
          role="group"
          tabIndex={0}
          aria-label={summary}
          aria-describedby={readoutId}
          onKeyDown={onKeyDown}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${geo.width} ${geo.height}`}
            aria-hidden="true"
            focusable="false"
            onPointerDown={onPointer}
            onPointerMove={(e) => {
              if (e.pointerType === 'mouse') onPointer(e);
            }}
          >
            {geo.ticks.map((t) => (
              <line key={`grid${t.value}`} x1="0" x2={geo.width} y1={t.y} y2={t.y} className="sd-gsc-grid" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2={geo.width} y1={geo.height - geo.pad} y2={geo.height - geo.pad} className="sd-gsc-baseline" />
            {geo.segments.map((d, i) => (
              <path key={i} d={d} className="sd-gsc-line" vectorEffect="non-scaling-stroke" />
            ))}
            {geo.points.map((pt, i) => (
              <circle key={`p${i}`} cx={pt.x} cy={pt.y} r="2.5" className="sd-gsc-dot" vectorEffect="non-scaling-stroke" />
            ))}
            {geo.partials.map((pt, i) => (
              <rect key={`q${i}`} x={pt.x - 3.5} y={pt.y - 3.5} width="7" height="7" className="sd-gsc-partial" vectorEffect="non-scaling-stroke" />
            ))}
            {geo.gaps.map((g, i) => (
              <circle key={`g${i}`} cx={g.x} cy={g.y} r="2.5" className="sd-gsc-gap" vectorEffect="non-scaling-stroke" />
            ))}
            {guideX !== null && (
              <line x1={guideX} x2={guideX} y1={geo.pad} y2={geo.height - geo.pad} className="sd-gsc-guide" vectorEffect="non-scaling-stroke" />
            )}
            {focusY !== null && guideX !== null && (
              <circle cx={guideX} cy={focusY} r="4.5" className="sd-gsc-focus" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        </div>
      </div>
      <p id={readoutId} className="sd-gsc-readout" aria-live="polite" data-missing={readout?.missing ? 'true' : 'false'}>
        {readout ? readout.text : 'Toca el gráfico o usa las flechas del teclado para ver el valor de un día.'}
      </p>
      <div className="sd-gsc-chart-axis">
        <span>{series[0]?.date ? formatDay(series[0].date) : ''}</span>
        <span>{series[n - 1]?.date ? formatDay(series[n - 1].date) : ''}</span>
      </div>
    </figure>
  );
}

// Posición Y de un valor con la misma escala que la geometría del gráfico.
function yForValue(value, geo) {
  const y = geo.height - geo.pad - (value / geo.max) * (geo.height - 2 * geo.pad);
  return y.toFixed(1);
}

function ChartLegend({ showPartial }) {
  return (
    <p className="sd-gsc-legend">
      Hueco: día sin registro (no es cero).
      {showPartial ? ' Cuadrado: día con datos de una sola marca en «Todas».' : ''}
    </p>
  );
}

function DailyTable({ series, showBrands }) {
  return (
    <details className="sd-gsc-details">
      <summary>Ver datos diarios</summary>
      <div className="sd-gsc-table-wrap" tabIndex={0}>
        <table className="sd-gsc-table">
          <caption className="sd-sr-only">Datos diarios de Search Console</caption>
          <thead>
            <tr>
              <th scope="col">Día</th>
              <th scope="col" className="sd-num">Clics</th>
              <th scope="col" className="sd-num">Impresiones</th>
              {showBrands && <th scope="col">Marcas con datos</th>}
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.date} data-row={p.hasRow ? 'true' : 'false'} data-partial={p.partial ? 'true' : 'false'}>
                <td>{formatDay(p.date)}{p.provisional ? ' · provisional' : ''}</td>
                <td className="sd-num">{p.hasRow ? formatCount(p.clicks) : 'Sin registro'}</td>
                <td className="sd-num">{p.hasRow ? formatCount(p.impressions) : 'Sin registro'}</td>
                {showBrands && (
                  <td>
                    {p.hasRow
                      ? p.partial
                        ? `Solo ${p.brandLabels.join(', ')} (parcial)`
                        : p.brandLabels.join(' + ')
                      : 'Ninguna'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function CoverageList({ items }) {
  return (
    <section className="sd-gsc-coverage" aria-label="Cobertura por marca">
      <h3 className="sd-gsc-coverage-title">Cobertura por marca</h3>
      <ul>
        {items.map((c) => (
          <li key={c.domain}>
            <span className="sd-gsc-coverage-brand">{c.label}</span> {c.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Breakdown({ rows }) {
  return (
    <div className="sd-gsc-breakdown" role="group" aria-label="Desglose por marca">
      {rows.map((r) => (
        <div key={r.domain} className="sd-gsc-brand" data-domain={r.domain}>
          <div className="sd-gsc-brand-name">{r.label}</div>
          <dl className="sd-gsc-brand-stats">
            <div><dt>Clics</dt><dd>{r.clicks}</dd></div>
            <div><dt>Impresiones</dt><dd>{r.impressions}</dd></div>
            <div><dt>CTR</dt><dd>{r.ctr}</dd></div>
            <div><dt>Posición GSC</dt><dd>{r.position}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}

export default function GscPanel({ supabase, brand }) {
  const [period, setPeriod] = useState(28);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: null, view: null });

  const key = `${brand}|${period}|${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    const requestKey = `${brand}|${period}|${attempt}`;

    const load = async () => {
      let token = null;
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token ?? null;
      } catch {
        token = null;
      }
      if (!token) {
        setResult({ key: requestKey, view: { state: VIEW_STATES.AUTH } });
        return;
      }
      try {
        const response = await fetch(
          `/api/gsc/metrics?brand=${encodeURIComponent(brand)}&period=${period}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal }
        );
        if (!response.ok) {
          setResult({ key: requestKey, view: { state: stateFromHttp(response.status) } });
          return;
        }
        const payload = await response.json();
        setResult({ key: requestKey, view: buildGscView({ payload, brand, period }) });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setResult({ key: requestKey, view: { state: VIEW_STATES.NETWORK } });
      }
    };

    load();
    return () => controller.abort();
  }, [brand, period, attempt, supabase]);

  // Una respuesta solo se pinta si corresponde a la marca y periodo actuales.
  const current = result.key === key ? result.view : null;
  const loading = current === null;
  const retry = () => setAttempt((n) => n + 1);
  const isAll = brand === 'all';

  let body;
  if (loading) {
    body = (
      <div className="sd-gsc-kpis" aria-busy="true">
        {['Clics', 'Impresiones', 'CTR', 'Posición media GSC'].map((label) => (
          <div key={label} className="sd-card sd-kpi sd-gsc-kpi">
            <div className="sd-kpi-label">{label}</div>
            <div className="sd-kpi-value" data-empty="true">—</div>
            <div className="sd-kpi-note">Cargando…</div>
          </div>
        ))}
      </div>
    );
  } else if (STATE_COPY[current.state]) {
    const copy = STATE_COPY[current.state];
    body = (
      <div className="sd-state" role="alert">
        <p className="sd-state-title">{copy.title}</p>
        <p className="sd-state-text">{copy.text}</p>
        {copy.retry && (
          <button type="button" className="sd-button" onClick={retry}>Reintentar</button>
        )}
        {current.state === VIEW_STATES.AUTH && <a className="sd-button" href="/login">Ir al acceso</a>}
      </div>
    );
  } else {
    body = (
      <>
        <div className="sd-gsc-kpis">
          {current.kpis.map((k) => (
            <KpiTile key={k.id} kpi={k} />
          ))}
        </div>

        {current.state === VIEW_STATES.EMPTY ? (
          <div className="sd-state" role="status">
            <p className="sd-state-title">Sin días con datos en este periodo</p>
            <p className="sd-state-text">
              Que no haya registros no equivale a cero clics. Prueba otro periodo o revisa la sincronización.
            </p>
          </div>
        ) : (
          <>
            <div className="sd-gsc-charts">
              <TrendChart key={`${brand}-${period}-clicks`} series={current.series} metricKey="clicks" label="Clics diarios" unit="Clics" tone="clicks" />
              <TrendChart key={`${brand}-${period}-impressions`} series={current.series} metricKey="impressions" label="Impresiones diarias" unit="Impresiones" tone="impressions" />
            </div>
            <ChartLegend showPartial={isAll} />
            <DailyTable series={current.series} showBrands={isAll} />
          </>
        )}

        <CoverageList items={current.coverage} />
        {current.breakdown && <Breakdown rows={current.breakdown} />}
      </>
    );
  }

  return (
    <section className="sd-card sd-gsc" aria-labelledby="sd-gsc-title" data-brand={brand}>
      <div className="sd-section-head sd-gsc-head">
        <div>
          <h2 id="sd-gsc-title" className="sd-section-title">Rendimiento en Google (Search Console)</h2>
          <p className="sd-section-meta">
            {current?.range?.start
              ? `${current.range.start} – ${current.range.end} · Fuente: Search Console`
              : 'Fuente: Search Console'}
            {current?.lastFetchedAt ? ` · Métricas actualizadas: ${current.lastFetchedAt}` : ''}
          </p>
        </div>
        <div className="sd-segmented" role="group" aria-label="Periodo de Search Console">
          {GSC_PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {p} días
            </button>
          ))}
        </div>
      </div>

      {body}

      {!loading && current.notes && current.notes.length > 0 && (
        <ul className="sd-gsc-notes">
          {current.notes.map((n, i) => (
            <li key={i} data-tone={n.tone}>{n.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
