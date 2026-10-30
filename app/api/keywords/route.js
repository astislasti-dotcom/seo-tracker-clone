// E1: this endpoint is retired. It previously allowed anonymous inserts into
// `keywords` through the public anon key. Nothing in the app consumes it, so both
// methods answer 410 Gone and never touch Supabase. Restoring any access requires
// a new, authenticated design approved in issue #15.

function retired() {
  return Response.json(
    { error: 'endpoint_retired' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}
