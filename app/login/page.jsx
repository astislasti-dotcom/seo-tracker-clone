'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Owner access by one-time link. Supabase must have public sign-ups disabled, so only
// the account created by the owner can receive a link. The server also checks the owner
// email on every data request.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');

  async function onSubmit(event) {
    event.preventDefault();
    setStatus('sending');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/dashboard`, shouldCreateUser: false },
      });
      setStatus(error ? 'error' : 'sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '10vh auto', padding: '0 16px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Acceso al panel</h1>
      {status === 'sent' ? (
        <p role="status">Si la dirección está autorizada, recibirás un enlace de acceso. Ábrelo en este mismo navegador.</p>
      ) : (
        <form onSubmit={onSubmit}>
          <label htmlFor="owner-email" style={{ display: 'block', marginBottom: 6 }}>Correo autorizado</label>
          <input
            id="owner-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: 10, marginBottom: 12 }}
          />
          <button type="submit" disabled={status === 'sending'} style={{ padding: '10px 16px' }}>
            {status === 'sending' ? 'Enviando…' : 'Enviar enlace'}
          </button>
          {status === 'error' && <p role="alert">No se pudo enviar el enlace. Inténtalo más tarde.</p>}
        </form>
      )}
    </main>
  );
}
