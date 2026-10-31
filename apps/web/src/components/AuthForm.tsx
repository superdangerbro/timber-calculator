'use client';
import { useState } from 'react';
import { LogoMark } from './Logo';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.issues?.[0]?.message ?? body.error ?? 'Something went wrong');
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.href = next && next.startsWith('/') ? next : '/';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <LogoMark size={44} />
        <h1>{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
        <p className="sub">{mode === 'login' ? 'Timber Calculator office dashboard' : 'Each cruiser gets a tag prefix so offline phones never collide.'}</p>
        <form onSubmit={onSubmit}>
          {error && <div className="auth-err" role="alert">{error}</div>}
          {mode === 'signup' && (
            <div><label className="label" htmlFor="name">Name</label><input className="input" id="name" name="name" autoComplete="name" required placeholder="Joe Hughes" /></div>
          )}
          <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></div>
          <div><label className="label" htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'signup' ? 8 : 1} /></div>
          {mode === 'signup' && (
            <div>
              <label className="label" htmlFor="tagPrefix">Tag prefix (optional)</label>
              <input className="input" id="tagPrefix" name="tagPrefix" maxLength={3} placeholder="e.g. J — leave blank to pick from your name" style={{ textTransform: 'uppercase' }} />
            </div>
          )}
          <button className="btn primary" disabled={busy} type="submit">{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <p className="muted" style={{ marginTop: 18, marginBottom: 0, textAlign: 'center' }}>
          {mode === 'login' ? <>New to the crew? <a href="/signup">Create an account</a></> : <>Already have an account? <a href="/login">Sign in</a></>}
        </p>
      </div>
    </main>
  );
}
