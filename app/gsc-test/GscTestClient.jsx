'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { gscErrorMessage } from '../../lib/gsc/errors.mjs';
import {
  DIAG_BRANDS,
  DIAG_GENERIC_ERROR,
  DIAG_PERIODS,
  buildSummaryPath,
  describeSuccess,
} from '../../lib/gsc/diagnostic.mjs';

// Session only: the access token is read in memory when the button is pressed, sent in
// the Authorization header, and never stored, logged or placed in a URL.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

const pct = (value) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(2)} %`);
const num = (value) => (value === null || value === undefined ? '—' : new Intl.NumberFormat('es-ES').format(value));

export default function GscTestClient() {
  const [brand, setBrand] = useState(DIAG_BRANDS[0].domain);
  const [period, setPeriod] = useState(28);
  const [state, setState] = useState({ status: 'idle' });

  async function onQuery() {
    setState({ status: 'loading' });
    let token = null;
    try {
      ({ data: { session: { access_token: token } = {} } = {} } = await supabase.auth.getSession());
    } catch {
      token = null;
    }
    if (!token) {
      setState({ status: 'no_session' });
      return;
    }

    const path = buildSummaryPath({ brand, period });
    if (!path) {
      setState({ status: 'error', message: DIAG_GENERIC_ERROR });
      return;
    }

    try {
      const response = await fetch(path, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        setState({ status: 'no_session' });
        return;
      }
      if (!response.ok) {
        setState({ status: 'error', message: body?.error ? gscErrorMessage(body.error) : DIAG_GENERIC_ERROR });
        return;
      }
      setState({ status: 'ok', result: describeSuccess(body) });
    } catch {
      setState({ status: 'error', message: DIAG_GENERIC_ERROR });
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '6vh auto', padding: '0 16px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 20 }}>Diagnóstico de Search Console (temporal)</h1>
      <p style={{ color: '#555' }}>Solo lectura. Requiere sesión del propietario. No guarda resultados.</p>

      <fieldset style={{ border: 0, padding: 0, marginBottom: 12 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Marca</legend>
        {DIAG_BRANDS.map((b) => (
          <label key={b.domain} style={{ marginRight: 16 }}>
            <input type="radio" name="brand" value={b.domain} checked={brand === b.domain} onChange={() => setBrand(b.domain)} /> {b.label}
          </label>
        ))}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, marginBottom: 12 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Periodo</legend>
        {DIAG_PERIODS.map((d) => (
          <label key={d} style={{ marginRight: 16 }}>
            <input type="radio" name="period" value={d} checked={period === d} onChange={() => setPeriod(d)} /> {d} días
          </label>
        ))}
      </fieldset>

      <button type="button" onClick={onQuery} disabled={state.status === 'loading'} style={{ padding: '10px 16px' }}>
        Consultar GSC
      </button>

      <section aria-live="polite" style={{ marginTop: 20 }}>
        {state.status === 'no_session' && (
          <p role="status">No hay una sesión autorizada. <a href="/login">Iniciar sesión</a> y vuelve a intentarlo.</p>
        )}
        {state.status === 'error' && <p role="alert">{state.message}</p>}
        {state.status === 'loading' && <p>Consultando…</p>}
        {state.status === 'ok' && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px' }}>
            <dt>Marca</dt><dd>{state.result.brand}</dd>
            <dt>Periodo</dt><dd>{state.result.period} días ({state.result.startDate} – {state.result.endDate})</dd>
            <dt>Consulta</dt><dd>{state.result.fetchedAt}</dd>
            <dt>Clics</dt><dd>{num(state.result.clicks)}</dd>
            <dt>Impresiones</dt><dd>{num(state.result.impressions)}</dd>
            <dt>CTR</dt><dd>{pct(state.result.ctr)}</dd>
            <dt>Posición media GSC</dt><dd>{state.result.averagePosition === null ? '—' : state.result.averagePosition.toFixed(1)}</dd>
            {state.result.noData && <><dt>Nota</dt><dd>Sin datos finales en este periodo.</dd></>}
            <dt>Aviso</dt><dd>{state.result.positionLabel}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
