// GSC-02b · sincronización de una propiedad. Orden estricto:
//   1) registrar la ejecución ('running');
//   2) leer TODOS los bloques (final + all) y validarlos; si algo falla, no se escribe nada;
//   3) escribir con la lógica protegida de store.mjs;
//   4) cerrar la ejecución ('ok' o 'error' con código).
// Cualquier excepción se reduce a un código. Nunca se devuelve el error original.
import { fetchDailyRows } from './client.mjs';
import { writeDailyRows } from './store.mjs';
import { classifyDailyRows, splitBlocks } from './sync-plan.mjs';

async function closeRun(repo, runId, patch) {
  if (runId === null) return;
  try {
    await repo.finishRun(runId, patch);
  } catch {
    // Si no se puede cerrar la ejecución, el código de error ya se devuelve al llamador.
  }
}

export async function syncProperty({ property, window, credentials, transport, repo, now }) {
  const base = {
    ok: false,
    domain: property.domain,
    brand: property.brand,
    startDate: window.startDate,
    endDate: window.endDate,
  };
  let runId = null;

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

  const fail = async (code) => {
    await closeRun(repo, runId, {
      status: 'error',
      error_code: code,
      finished_at: new Date().toISOString(),
      rows_received: 0,
    });
    return { ...base, code };
  };

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

  let counts;
  try {
    counts = await writeDailyRows(repo, property.domain, merged, now.toISOString());
  } catch {
    return fail('storage_error');
  }

  await closeRun(repo, runId, {
    status: 'ok',
    finished_at: new Date().toISOString(),
    rows_received: merged.length,
  });

  return {
    ...base,
    ok: true,
    rowsReceived: merged.length,
    final: merged.filter((row) => row.dataState === 'final').length,
    provisional: merged.filter((row) => row.dataState === 'provisional').length,
    firstIncompleteDate,
    ...counts,
  };
}
