'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { buildDashboardModel, DISPLAY } from '../../lib/keywords/measurements.mjs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const EMPTY_MODEL = {
  status: 'loading',
  keywords: [],
  counts: { total: 0, ranked: 0, top10: 0, notFound: 0, unverified: 0 },
  averagePosition: null,
  lastMeasuredAt: null,
};

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('es-ES');
}

function lastMeasurementLabel(model) {
  const formatted = model.lastMeasuredAt ? formatDate(model.lastMeasuredAt) : null;
  return formatted ? `Última medición verificada: ${formatted}` : 'Sin medición verificada';
}

function positionText(kw) {
  if (kw.state === DISPLAY.RANKED) return `#${kw.position}`;
  if (kw.state === DISPLAY.NOT_FOUND) return 'No aparece';
  return 'Sin medición verificada';
}

const STATUS_MESSAGES = {
  catalog_error: 'No se pudo cargar el catálogo de keywords. No se muestran datos.',
  empty: 'El catálogo de keywords está vacío.',
  measurements_error: 'No se pudieron cargar las mediciones. Las posiciones no se muestran hasta recuperar datos verificados.',
};

export default function Dashboard() {
  const [model, setModel] = useState(EMPTY_MODEL);
  const [activeTab, setActiveTab] = useState('overview');
  const [activeDomain, setActiveDomain] = useState('all');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let catalogRaw;
      try {
        const response = await fetch('/keywords.json');
        if (!response.ok) throw new Error('catalog_http_error');
        catalogRaw = await response.json();
      } catch {
        if (!cancelled) setModel(buildDashboardModel({ catalogRaw: null }));
        return;
      }

      // No row limit: every observation is fetched and attributed by logical key.
      // Legacy rows without a keyword_key cannot be attributed and show as unverified.
      let next;
      try {
        const { data: rows, error } = await supabase.from('keyword_tracking').select('*');
        if (error) console.error('keyword_tracking read failed');
        next = buildDashboardModel({ catalogRaw, rows: rows ?? [], error: error ?? null });
      } catch {
        next = buildDashboardModel({ catalogRaw, rows: [], error: new Error('read_failed') });
      }
      if (!cancelled) setModel(next);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = model.status === 'loading';
  const keywords = model.keywords;
  const counts = model.counts;

  const filteredKeywords =
    activeDomain === 'all'
      ? keywords
      : keywords.filter(k => k.domain === activeDomain);

  const showTable = !loading && (model.status === 'ok' || model.status === 'measurements_error');
  const statusMessage = STATUS_MESSAGES[model.status];

  return (
    <div style={{ fontFamily: "'Open Sans', sans-serif", background: '#f5f5f5', minHeight: '100vh' }}>
      {/* Sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
        <div style={{ background: '#004e5a', color: 'white', padding: '24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: '32px', paddingBottom: '24px', borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>SEO Suite</div>
          </div>
          <div
            onClick={() => setActiveTab('overview')}
            style={{
              padding: '12px 0',
              cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontSize: '13px',
              color: activeTab === 'overview' ? '#33c4b4' : 'white',
              fontWeight: activeTab === 'overview' ? 600 : 400,
            }}
          >
            📊 Overview
          </div>
          <div
            onClick={() => setActiveTab('3av')}
            style={{
              padding: '12px 0',
              cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontSize: '13px',
              color: activeTab === '3av' ? '#33c4b4' : 'white',
            }}
          >
            🎬 3AV
          </div>
          <div
            onClick={() => setActiveTab('asti')}
            style={{
              padding: '12px 0',
              cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontSize: '13px',
              color: activeTab === 'asti' ? '#33c4b4' : 'white',
            }}
          >
            🏢 ASTI
          </div>
          <div
            onClick={() => setActiveTab('reports')}
            style={{
              padding: '12px 0',
              cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontSize: '13px',
              color: activeTab === 'reports' ? '#33c4b4' : 'white',
            }}
          >
            📋 Reports
          </div>
          <div style={{ marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
            {loading ? 'Cargando mediciones…' : lastMeasurementLabel(model)}
          </div>
        </div>

        {/* Main */}
        <div style={{ padding: '24px', background: '#f5f5f5' }}>
          {/* Header */}
          <div style={{ background: 'white', padding: '20px', borderRadius: '8px', marginBottom: '24px', borderLeft: '4px solid #33c4b4' }}>
            <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '22px', color: '#004e5a', margin: 0, fontWeight: 700 }}>
              Control SEO Integral
            </h1>
            <p style={{ color: '#888', fontSize: '12px', margin: '4px 0 0 0' }}>
              {loading ? 'Cargando mediciones…' : lastMeasurementLabel(model)}
            </p>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, background: 'white', borderRadius: '8px', marginBottom: '24px' }}>
            {['overview', '3av', 'asti', 'reports'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '14px 20px',
                  cursor: 'pointer',
                  border: 'none',
                  background: 'white',
                  borderBottom: activeTab === tab ? '3px solid #33c4b4' : '3px solid transparent',
                  fontWeight: activeTab === tab ? 500 : 400,
                  color: activeTab === tab ? '#33c4b4' : '#999',
                  fontSize: '12px',
                  textTransform: 'uppercase',
                }}
              >
                {tab === 'overview' && '📊 Overview'}
                {tab === '3av' && '🎬 3AV'}
                {tab === 'asti' && '🏢 ASTI'}
                {tab === 'reports' && '📋 Reports'}
              </button>
            ))}
          </div>

          {statusMessage && (
            <div role="alert" style={{ background: '#fff4e5', border: '1px solid #f0c36d', color: '#7a4d00', padding: '12px 16px', borderRadius: '8px', marginBottom: '24px', fontSize: '13px' }}>
              {statusMessage}
            </div>
          )}

          {activeTab === 'overview' && (
            <>
              {/* KPI Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                <div style={{ background: 'white', padding: '20px', borderRadius: '8px', borderLeft: '3px solid #33c4b4' }}>
                  <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>
                    Top 10 verificadas
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#004e5a' }}>
                    {loading ? '—' : counts.top10}
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '8px', color: '#666' }}>
                    {loading ? 'Cargando…' : `${counts.ranked} con posición verificada de ${counts.total}`}
                  </div>
                </div>
                <div style={{ background: 'white', padding: '20px', borderRadius: '8px', borderLeft: '3px solid #33c4b4' }}>
                  <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>
                    Posición media verificada
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#004e5a' }}>
                    {loading || model.averagePosition === null ? '—' : model.averagePosition.toFixed(1)}
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '8px', color: '#666' }}>
                    {loading ? 'Cargando…' : `${counts.notFound} sin aparecer · ${counts.unverified} sin medición verificada`}
                  </div>
                </div>
              </div>

              {/* Domain Filter */}
              <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
                {['all', '3av.events', 'astisl.es'].map(domain => (
                  <button
                    key={domain}
                    onClick={() => setActiveDomain(domain)}
                    style={{
                      padding: '8px 16px',
                      border: activeDomain === domain ? '2px solid #33c4b4' : '1px solid #ddd',
                      background: activeDomain === domain ? '#f0f9f8' : 'white',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: activeDomain === domain ? 600 : 400,
                      color: activeDomain === domain ? '#004e5a' : '#666',
                    }}
                  >
                    {domain === 'all' ? 'Todas' : domain}
                  </button>
                ))}
              </div>

              {/* Keywords Table */}
              <div style={{ background: 'white', padding: '24px', borderRadius: '8px' }}>
                <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '16px', color: '#004e5a', marginBottom: '16px', fontWeight: 700 }}>
                  Keywords
                </h2>
                {loading && <p>Cargando datos...</p>}
                {showTable && (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ background: '#f9f9f9', padding: '12px', textAlign: 'left', fontSize: '11px', color: '#666', fontWeight: 600, borderBottom: '2px solid #e2e8f0' }}>
                          Keyword
                        </th>
                        <th style={{ background: '#f9f9f9', padding: '12px', textAlign: 'left', fontSize: '11px', color: '#666', fontWeight: 600, borderBottom: '2px solid #e2e8f0' }}>
                          Web
                        </th>
                        <th style={{ background: '#f9f9f9', padding: '12px', textAlign: 'left', fontSize: '11px', color: '#666', fontWeight: 600, borderBottom: '2px solid #e2e8f0' }}>
                          Posición
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKeywords.map(kw => (
                        <tr key={kw.key} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '12px', fontSize: '13px' }}>
                            <strong>{kw.keyword}</strong>
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '4px 10px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: 500,
                                background: kw.domain === '3av.events' ? '#e3f2fd' : '#f0f0f0',
                                color: kw.domain === '3av.events' ? '#004e5a' : '#555',
                              }}
                            >
                              {kw.domain === '3av.events' ? '3AV' : 'ASTI'}
                            </span>
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px', color: kw.state === DISPLAY.RANKED ? '#33c4b4' : '#999', fontWeight: 'bold' }}>
                            {positionText(kw)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {activeTab === '3av' && (
            <div style={{ background: 'white', padding: '24px', borderRadius: '8px' }}>
              <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '18px', color: '#004e5a', marginBottom: '20px' }}>
                3AV Events
              </h2>
              <p style={{ color: '#666', marginBottom: '16px' }}>
                Total keywords: {keywords.filter(k => k.domain === '3av.events').length}
              </p>
              {showTable && <DomainTable rows={keywords.filter(k => k.domain === '3av.events')} />}
            </div>
          )}

          {activeTab === 'asti' && (
            <div style={{ background: 'white', padding: '24px', borderRadius: '8px' }}>
              <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '18px', color: '#004e5a', marginBottom: '20px' }}>
                ASTI S.L.
              </h2>
              <p style={{ color: '#666', marginBottom: '16px' }}>
                Total keywords: {keywords.filter(k => k.domain === 'astisl.es').length}
              </p>
              {showTable && <DomainTable rows={keywords.filter(k => k.domain === 'astisl.es')} />}
            </div>
          )}

          {activeTab === 'reports' && (
            <div style={{ background: 'white', padding: '24px', borderRadius: '8px' }}>
              <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '18px', color: '#004e5a', marginBottom: '20px' }}>
                Reportes
              </h2>
              <p style={{ color: '#666', marginBottom: '16px' }}>
                Los reportes semanales y mensuales estarán disponibles próximamente.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DomainTable({ rows }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ background: '#f9f9f9', padding: '12px', textAlign: 'left', fontSize: '11px', color: '#666', fontWeight: 600, borderBottom: '2px solid #e2e8f0' }}>
            Keyword
          </th>
          <th style={{ background: '#f9f9f9', padding: '12px', textAlign: 'left', fontSize: '11px', color: '#666', fontWeight: 600, borderBottom: '2px solid #e2e8f0' }}>
            Posición
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(kw => (
          <tr key={kw.key} style={{ borderBottom: '1px solid #e2e8f0' }}>
            <td style={{ padding: '12px', fontSize: '13px' }}>{kw.keyword}</td>
            <td style={{ padding: '12px', fontSize: '13px', color: kw.state === DISPLAY.RANKED ? '#33c4b4' : '#999', fontWeight: 'bold' }}>
              {positionText(kw)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
