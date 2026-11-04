// GSC-01: owner-only, read-only Search Console summary. The service-account JSON is read
// from the server environment and is never returned, logged or sent to the browser.
import config from '../../../../config/gsc-properties.json' with { type: 'json' };
import { handleSummary } from '../../../../lib/gsc/handler.mjs';
import { verifySupabaseAccessToken } from '../../../../lib/auth/supabase-verify.mjs';

export async function GET(request) {
  return handleSummary(request, {
    config,
    ownerEmail: process.env.DASHBOARD_OWNER_EMAIL,
    verifyAccessToken: verifySupabaseAccessToken,
    rawCredentials: process.env.GSC_SERVICE_ACCOUNT_JSON,
  });
}
