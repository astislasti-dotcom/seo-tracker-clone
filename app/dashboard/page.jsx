'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Dashboard() {
  const [keywords, setKeywords] = useState([]);
  const [stats, setStats] = useState({
    p1Count: 0,
    avgPosition: 0,
    totalKeywords: 0,
  });
  const [activeTab, setActiveTab] = useState('overview');
  const [activeDomain, setActiveDomain] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // Get latest tracking data
      const { data: trackingData, error } = await supabase
        .from('keyword_tracking')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(31); // Assuming 31 keywords

      if (error) throw error;

      // Get keywords data
      const keywordResponse = await fetch('/keywords.json');
      const keywordsList = await keywordResponse.json();

      // Merge tracking data with keyword data
      const mergedData = keywordsList.map(kw => {
        const latestTracking = trackingData?.find(
          t => t.keyword_id === kw.id && t.domain === kw.domain
        );
        return {
          ...kw,
          position: latestTracking?.position || 0,
          timestamp: latestTracking?.timestamp,
        };
      });

      setKeywords(mergedData);

      // Calculate stats
      const p1 = mergedData.filter(k => k.position > 0 && k.position <= 10).length;
      const positions = mergedData
        .filter(k => k.position > 0)
        .map(k => k.position);
      const avg =
        positions.length > 0
          ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1)
          : 0;

      setStats({
        p1Count: p1,
        avgPosition: avg,
        totalKeywords: mergedData.length,
      });
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredKeywords =
    activeDomain === 'all'
      ? keywords
      : keywords.filter(k => k.domain === activeDomain);

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
            Data actualizada: hoy a las 06:00
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
              Última actualización: hoy
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

          {activeTab === 'overview' && (
            <>
              {/* KPI Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                <div style={{ background: 'white', padding: '20px', borderRadius: '8px', borderLeft: '3px solid #33c4b4' }}>
                  <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>
                    Keywords P1-P10
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#004e5a' }}>
                    {stats.p1Count}
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '8px', color: '#27ae60' }}>
                    ↑ Rastreados
                  </div>
                </div>
                <div style={{ background: 'white', padding: '20px', borderRadius: '8px', borderLeft: '3px solid #33c4b4' }}>
                  <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>
                    Posición Media
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#004e5a' }}>
                    {stats.avgPosition}
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '8px', color: '#666' }}>
                    De {stats.totalKeywords} keywords
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
                  Top Keywords
                </h2>
                {loading ? (
                  <p>Cargando datos...</p>
                ) : (
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
                      {filteredKeywords.slice(0, 10).map(kw => (
                        <tr key={kw.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
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
                          <td style={{ padding: '12px', fontSize: '13px', color: kw.position > 0 ? '#33c4b4' : '#999', fontWeight: 'bold' }}>
                            {kw.position > 0 ? `#${kw.position}` : 'No ranking'}
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
                  {keywords.filter(k => k.domain === '3av.events').map(kw => (
                    <tr key={kw.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px', fontSize: '13px' }}>{kw.keyword}</td>
                      <td style={{ padding: '12px', fontSize: '13px', color: kw.position > 0 ? '#33c4b4' : '#999', fontWeight: 'bold' }}>
                        {kw.position > 0 ? `#${kw.position}` : 'No ranking'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                  {keywords.filter(k => k.domain === 'astisl.es').map(kw => (
                    <tr key={kw.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px', fontSize: '13px' }}>{kw.keyword}</td>
                      <td style={{ padding: '12px', fontSize: '13px', color: kw.position > 0 ? '#33c4b4' : '#999', fontWeight: 'bold' }}>
                        {kw.position > 0 ? `#${kw.position}` : 'No ranking'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
