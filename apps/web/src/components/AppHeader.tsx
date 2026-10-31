'use client';
import { Brand } from './Logo';

export function AppHeader({ user, active, children }: {
  user: { name: string; prefix: string; email: string }; active: 'dashboard' | 'settings'; children?: React.ReactNode;
}) {
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <header className="appbar">
      <Brand />
      <nav className="appnav">
        <a href="/" className={active === 'dashboard' ? 'on' : ''}>Dashboard</a>
        <a href="/settings" className={active === 'settings' ? 'on' : ''}>Crew &amp; devices</a>
      </nav>
      <div className="appbar-mid">{children}</div>
      <div className="appbar-user">
        <span className="prefix-chip" title="Your tag prefix">{user.prefix}</span>
        <span className="who"><b>{user.name}</b><small>{user.email}</small></span>
        <button className="btn ghost small" onClick={logout}>Sign out</button>
      </div>
    </header>
  );
}
