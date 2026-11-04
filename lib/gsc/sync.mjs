// GSC-02b · sincronización de una propiedad. Orden de operaciones:
//
//   1) startRun: se escribe el registro inicial ('running') ANTES de cualquier llamada a
//      Google. Si esa escritura falla, no se llama a Google y el resultado es storage_error.
//   2) Lectura de TODOS los bloques (final + all) y validación completa. En este paso no se
//      escribe ninguna métrica. Si algo falla, el run se cierra como 'error' y no hay escrituras
//      de métricas.
//   3) Escritura de métricas (store.mjs). Solo se llega aquí con todos los datos validados.
//   4) finishRun 'ok'. Si falla, el resultado NO es correcto: las métricas están guardadas
//      pero el registro de ejecución quedó abierto → code 'run_log_failed', ok false.
//
// Campos del resultado que distinguen los dos hechos:
//   metricsSaved: las métricas se escribieron completas en gsc_daily_metrics.
//   runLogged:    el registro de gsc_sync_runs se cerró correctamente.
//   ok:           solo true si metricsSaved y runLogged son true.
//
// Ningún error original se devuelve; solo códigos fijos.
import { fetchDailyRows } from './client.mjs';
import { writeDailyRows } from './store.mjs';
import { classifyDailyRows, splitBlocks } from './sync-plan.mjs';

// Devuelve true solo si el cierre del registro se confirmó.
async function tryFinish(repo, runId, patch) {
  if (runId === null) return false;
  try {
    await repo.finishRun(runId, patch);
    return true;
  } catch {
    return false;
  }
}

export async function syncProperty({ property, window, credentials, transport, repo, now }) {
  const base = {
    ok: false,
    domain: property.domain,
    brand: property.brand,
    startDate: window.startDate,
    endDate: window.endDate,
    metricsSaved: false,
    runLogged: false,
  };
  let runId = null;

  // Paso 1: registro inicial antes de consultar Google.
  try {
    runId = await repo.startRun({
      property_domain: property.domain,
      start_date: window.startDate,
      end_date: window.endDate,
      started_at: now.toISOString(),
      status: 'running',
    });
  } catch {
    return { ...base, code: 'storage_error' };
  }

  // Cierre con error: el código original se mantiene aunque el registro no pueda cerrarse.
  const fail = async (code) => {
    const logged = await tryFinish(repo, runId, {
      status: 'error',
      error_code: code,
      finished_at: new Date().toISOString(),
      rows_received: 0,
    });
    return { ...base, code, runLogged: logged };
  };

  // Paso 2: lectura y validación completa de todos los bloques. Sin escrituras de métricas.
  const merged = [];
  let firstIncompleteDate = null;
  for (const block of splitBlocks(window.startDate, window.endDate)) {
    const finalResult = await fetchDailyRows({
      credentials,
      siteUrl: property.siteUrl,
      block,
      dataState: 'final',
      transport,
    });
    if (!finalResult.ok) return fail(finalResult.code);

    const allResult = await fetchDailyRows({
      credentials,
      siteUrl: property.siteUrl,
      block,
      dataState: 'all',
      transport,
    });
    if (!allResult.ok) return fail(allResult.code);

    firstIncompleteDate ??= allResult.firstIncompleteDate ?? null;
    merged.push(...classifyDailyRows(finalResult.rows, allResult.rows));
  }

  // Paso 3: escritura de métricas. Si falla a mitad, metricsSaved queda en false.
  let counts;
  try {
    counts = await writeDailyRows(repo, property.domain, merged, now.toISOString());
  } catch {
    return fail('storage_error');
  }

  // Paso 4: cierre del registro. Las métricas ya están guardadas: si el cierre falla, el
  // resultado se marca como run_log_failed y nunca como éxito.
  const logged = await tryFinish(repo, runId, {
    status: 'ok',
    finished_at: new Date().toISOString(),
    rows_received: merged.length,
  });

  const summary = {
    ...base,
    metricsSaved: true,
    runLogged: logged,
    rowsReceived: merged.length,
    final: merged.filter((row) => row.dataState === 'final').length,
    provisional: merged.filter((row) => row.dataState === 'provisional').length,
    firstIncompleteDate,
    ...counts,
  };
  if (!logged) return { ...summary, ok: false, code: 'run_log_failed' };
  return { ...summary, ok: true };
}
