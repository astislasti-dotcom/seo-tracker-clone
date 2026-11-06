// GSC-06D · lectura de solo lectura de la vista gsc_dimension_snapshots_current (PR #35).
// Solo servidor: usa la clave service_role. Solo SELECT sobre la vista, con columnas explícitas.
// No hay insert, update, delete ni rpc. Los errores se reducen a un código fijo; el texto de
// Supabase no se reenvía.
import { createClient } from '@supabase/supabase-js';

export const SNAPSHOT_VIEW = 'gsc_dimension_snapshots_current';
const COLUMNS =
  'property_domain,dimension,period_days,requested_at,window_start,window_end,data_state,' +
  'aggregation_type,response_aggregation_type,row_limit,row_count,truncated,payload';

export class SnapshotReadStorageError extends Error {
  constructor() {
    super('storage_error');
    this.code = 'storage_error';
  }
}

// `client` se inyecta en las pruebas. En producción se crea con la URL pública y la clave de servidor.
export function createSnapshotReadRepo({ url, serviceKey, client }) {
  const db =
    client ??
    createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  return {
    // Devuelve la captura vigente o null si no hay ninguna.
    async readCurrent(domain, dimension, period) {
      const { data, error } = await db
        .from(SNAPSHOT_VIEW)
        .select(COLUMNS)
        .eq('property_domain', domain)
        .eq('dimension', dimension)
        .eq('period_days', period);
      if (error || !Array.isArray(data)) throw new SnapshotReadStorageError();
      if (data.length === 0) return null;
      if (data.length > 1) throw new SnapshotReadStorageError();
      return data[0];
    },
  };
}
