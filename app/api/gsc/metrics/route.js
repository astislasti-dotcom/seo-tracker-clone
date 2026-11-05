// GSC-03: lectura owner-only de métricas diarias almacenadas (gsc_daily_metrics). Solo GET.
// La clave service_role se lee del entorno del servidor (sin prefijo NEXT_PUBLIC_) y nunca
// se devuelve ni llega al navegador. No llama a Google ni escribe en la base de datos.
import config from '../../../../config/gsc-properties.json' with { type: 'json' };
import { handleMetrics } from '../../../../lib/gsc/metrics-handler.mjs';
import { createMetricsRepo } from '../../../../lib/gsc/metrics-store.mjs';
import { verifySupabaseAccessToken } from '../../../../lib/auth/supabase-verify.mjs';

export async function GET(request) {
  return handleMetrics(request, {
    config,
    ownerEmail: process.env.DASHBOARD_OWNER_EMAIL,
    verifyAccessToken: verifySupabaseAccessToken,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    createRepo: createMetricsRepo,
  });
}
