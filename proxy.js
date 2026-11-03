// Hides the temporary /gsc-test diagnostic with a real 404 outside Vercel Preview.
// The page also checks the environment itself (defence in depth).
import { NextResponse } from 'next/server';
import { proxyDecision } from './lib/gsc/diagnostic.mjs';

export function proxy() {
  if (proxyDecision(process.env) === 'allow') return NextResponse.next();
  return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export const config = {
  matcher: ['/gsc-test'],
};
