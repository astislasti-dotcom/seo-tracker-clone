// GSC-02b · escritura idempotente y protegida de métricas diarias.
//
// Contrato del repositorio (inyectado; en producción lo implementa store-supabase.mjs):
//   insertMissing(records)            → fechas insertadas. Nunca sobrescribe filas existentes.
//   updateProvisional(domain, date, v) → true si actualizó; false si la fila no existe
//                                        como 'provisional' (una fila final queda intacta).
//   startRun(run)                     → id de la ejecución.
//   finishRun(id, patch)              → cierra la ejecución (ok o error).
//
// Protección de filas finales: ningún registro se escribe con un UPDATE sin la condición
// data_state = 'provisional'. Así, incluso si dos ejecuciones coinciden, una fila final
// no puede ser sustituida por un valor provisional ni por otro final.

export function toRecord(domain, row, fetchedAt) {
  return {
    property_domain: domain,
    metric_date: row.metricDate,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    avg_position: row.avgPosition,
    data_state: row.dataState,
    fetched_at: fetchedAt,
  };
}

// Devuelve contadores. Idempotente: repetir la misma sincronización no cambia el resultado.
export async function writeDailyRows(repo, domain, rows, fetchedAt) {
  const records = rows.map((row) => toRecord(domain, row, fetchedAt));
  const inserted = new Set(await repo.insertMissing(records));

  const counts = { inserted: inserted.size, updated: 0, alreadyFinal: 0, protectedFinal: 0 };
  for (const record of records) {
    if (inserted.has(record.metric_date)) continue;
    const changed = await repo.updateProvisional(domain, record.metric_date, record);
    if (changed) {
      counts.updated += 1;
    } else if (record.data_state === 'final') {
      // Ya era final: el día no se toca.
      counts.alreadyFinal += 1;
    } else {
      // Llegó un provisional sobre una fila final: se protege la final.
      counts.protectedFinal += 1;
    }
  }
  return counts;
}
