import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { diagnosticEnabled } from '../../lib/gsc/diagnostic.mjs';
import GscTestClient from './GscTestClient';

// Temporary diagnostic page. Hidden (404) outside Vercel Preview. Not linked from any menu.
export const metadata = { robots: { index: false, follow: false } };

// The environment is read per request, inside Suspense, so the static shell stays free of it.
async function Gate() {
  await connection();
  if (!diagnosticEnabled(process.env)) notFound();
  return <GscTestClient />;
}

export default function GscTestPage() {
  return (
    <Suspense fallback={null}>
      <Gate />
    </Suspense>
  );
}
