'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { MSG_NETWORK, loginErrorMessage, normalizeEmail } from '../../lib/auth/password-login.mjs';

// Owner access with email and password. Public sign-ups are disabled in Supabase, so only
// the existing owner account can sign in. The server still checks the owner email on every
// data request (lib/auth/owner.mjs); this page is not the security boundary.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      });
      setPassword('');
      if (error) {
        setStatus('error');
        setMessage(loginErrorMessage(error));
        return;
      }
      router.push('/dashboard');
    } catch {
      setPassword('');
      setStatus('error');
      setMessage(MSG_NETWORK);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '10vh auto', padding: '0 16px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Acceso al panel</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="owner-email" style={{ display: 'block', marginBottom: 6 }}>Correo</label>
        <input
          id="owner-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: '100%', padding: 10, marginBottom: 12 }}
        />
        <label htmlFor="owner-password" style={{ display: 'block', marginBottom: 6 }}>Contraseña</label>
        <input
          id="owner-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', padding: 10, marginBottom: 12 }}
        />
        <button type="submit" disabled={status === 'sending'} style={{ padding: '10px 16px' }}>
          {status === 'sending' ? 'Entrando…' : 'Entrar'}
        </button>
        {status === 'error' && <p role="alert" style={{ marginTop: 12 }}>{message}</p>}
      </form>
    </main>
  );
}
