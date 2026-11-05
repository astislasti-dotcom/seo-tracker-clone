// GSC-03 · lectura de solo lectura de gsc_daily_metrics. Solo servidor: usa la clave
// service_role (la tabla no concede SELECT a anon ni authenticated). Nunca escribe.
// Los errores se reducen al código 'storage_error'; el texto de Supabase no se reenvía.
import { createClient } from '@supabase/supabase-js';

const METRICS = 'gsc_daily_metrics';
const COLUMNS = 'property_domain,metric_date,clicks,impressions,ctr,avg_position,data_state,fetched_at';

export class MetricsStorageError extends Error {
  constructor() {
    super('storage_error');
    this.code = 'storage_error';
  }
}

// `client` se inyecta en las pruebas. En producción se crea con la URL pública y la clave de servidor.
export function createMetricsRepo({ url, serviceKey, client }) {
  const db =
    client ??
    createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  return {
    // domains: lista de property_domain. startDate/endDate: fechas ISO inclusivas.
    async readDaily(domains, startDate, endDate) {
      const { data, error } = await db
        .from(METRICS)
        .select(COLUMNS)
        .in('property_domain', domains)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .order('metric_date', { ascending: true });
      if (error || !Array.isArray(data)) throw new MetricsStorageError();
      return data;
    },
  };
}
