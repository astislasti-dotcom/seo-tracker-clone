// GSC-06D: lectura owner-only de capturas vigentes (gsc_dimension_snapshots_current). Solo GET.
// La clave service_role se lee del entorno del servidor (sin prefijo NEXT_PUBLIC_) y nunca
// se devuelve ni llega al navegador. No llama a Google ni escribe en la base de datos.
import config from '../../../../config/gsc-properties.json' with { type: 'json' };
import { handleSnapshotRead } from '../../../../lib/gsc/snapshot-read-handler.mjs';
import { createSnapshotReadRepo } from '../../../../lib/gsc/snapshot-read-store.mjs';
import { verifySupabaseAccessToken } from '../../../../lib/auth/supabase-verify.mjs';

export async function GET(request) {
  return handleSnapshotRead(request, {
    config,
    ownerEmail: process.env.DASHBOARD_OWNER_EMAIL,
    verifyAccessToken: verifySupabaseAccessToken,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    createRepo: createSnapshotReadRepo,
  });
}
