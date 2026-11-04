// GSC-02b · adaptador de Supabase para la escritura. Solo servidor: usa la clave
// service_role, que nunca debe llegar al navegador ni a los logs. Los errores se reducen a
// un código fijo; el texto de Supabase no se reenvía.
import { createClient } from '@supabase/supabase-js';

const METRICS = 'gsc_daily_metrics';
const RUNS = 'gsc_sync_runs';

export class StorageError extends Error {
  constructor() {
    super('storage_error');
    this.code = 'storage_error';
  }
}

function fail() {
  throw new StorageError();
}

// `client` se inyecta en las pruebas. En producción se crea con la URL pública y la clave
// de servidor, sin sesión persistente.
export function createSupabaseRepo({ url, serviceKey, client }) {
  const db =
    client ??
    createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  return {
    async insertMissing(records) {
      // ignoreDuplicates → ON CONFLICT DO NOTHING: nunca sobrescribe una fila existente.
      const { data, error } = await db
        .from(METRICS)
        .upsert(records, { onConflict: 'property_domain,metric_date', ignoreDuplicates: true })
        .select('metric_date');
      if (error) fail();
      return (data ?? []).map((row) => row.metric_date);
    },

    async updateProvisional(domain, date, record) {
      // La condición data_state = 'provisional' va en el propio UPDATE.
      const values = Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== 'property_domain' && key !== 'metric_date')
      );
      const { data, error } = await db
        .from(METRICS)
        .update(values)
        .eq('property_domain', domain)
        .eq('metric_date', date)
        .eq('data_state', 'provisional')
        .select('metric_date');
      if (error) fail();
      return (data ?? []).length > 0;
    },

    async startRun(run) {
      const { data, error } = await db.from(RUNS).insert(run).select('id').single();
      if (error || !data) fail();
      return data.id;
    },

    async finishRun(id, patch) {
      const { error } = await db.from(RUNS).update(patch).eq('id', id);
      if (error) fail();
    },
  };
}
