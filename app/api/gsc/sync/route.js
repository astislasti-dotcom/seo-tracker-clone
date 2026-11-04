// GSC-02b: sincronización manual de Search Console → gsc_daily_metrics. Solo POST, solo
// propietario. La clave service_role se lee del entorno del servidor (sin prefijo
// NEXT_PUBLIC_) y nunca se devuelve, se registra ni llega al navegador.
import config from '../../../../config/gsc-properties.json' with { type: 'json' };
import { handleSync } from '../../../../lib/gsc/sync-handler.mjs';
import { createSupabaseRepo } from '../../../../lib/gsc/store-supabase.mjs';
import { verifySupabaseAccessToken } from '../../../../lib/auth/supabase-verify.mjs';

export async function POST(request) {
  return handleSync(request, {
    config,
    ownerEmail: process.env.DASHBOARD_OWNER_EMAIL,
    verifyAccessToken: verifySupabaseAccessToken,
    rawCredentials: process.env.GSC_SERVICE_ACCOUNT_JSON,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    createRepo: createSupabaseRepo,
    transport: undefined,
  });
}
