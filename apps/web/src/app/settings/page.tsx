import { desc, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { getDb } from '@/db';
import { devices, events, trees, users } from '@/db/schema';
import { AppHeader } from '@/components/AppHeader';
import { requirePageSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Crew & devices' };

function ago(d: Date) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export default async function SettingsPage() {
  const me = await requirePageSession();
  const db = getDb();
  const [crew, devs, evCounts, treeCounts] = await Promise.all([
    db.select().from(users).orderBy(users.tagPrefix),
    db.select().from(devices).orderBy(desc(devices.lastSeen)),
    db.select({ deviceId: events.deviceId, n: sql<number>`count(*)::int`, last: sql<string>`max(${events.createdAt})` }).from(events).groupBy(events.deviceId),
    db.select({ by: trees.createdBy, n: sql<number>`count(*) filter (where not ${trees.voided})::int`, maxTag: sql<number>`max(${trees.tagNumber}) filter (where not coalesce(${trees.leaveTree}, false))` }).from(trees).groupBy(trees.createdBy),
  ]);
  const evBy = new Map(evCounts.map((e) => [e.deviceId, e]));
  const treesBy = new Map(treeCounts.map((t) => [t.by, t]));
  const userBy = new Map(crew.map((u) => [u.id, u]));
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;
  const myTrees = treesBy.get(me.sub);
  const webEvents = evBy.get('web');

  return (
    <div className="app settings-app">
      <AppHeader user={{ name: me.name, email: me.email, prefix: me.prefix }} active="settings" />
      <main className="settings">
        <section className="card hero-card">
          <div className="big-prefix" aria-label="Your tag prefix">{me.prefix}</div>
          <div>
            <h1>Your tag prefix is <span className="tag">{me.prefix}</span></h1>
            <p className="muted">Every tree you tally is tagged <span className="tag">{me.prefix}-0001</span>, <span className="tag">{me.prefix}-0002</span>… and leave trees use <span className="tag">{me.prefix}-L0001</span>.
              Prefixes are unique per cruiser, so phones that are offline for days never hand out the same tag twice.</p>
            <p className="muted" style={{ marginBottom: 0 }}>{myTrees ? <>You have <b>{myTrees.n}</b> live trees; next tag will be <span className="tag">{me.prefix}-{String((myTrees.maxTag ?? 0) + 1).padStart(4, '0')}</span>.</> : 'No trees tallied yet.'}</p>
          </div>
        </section>

        <div className="settings-grid">
          <section className="card">
            <h2>Crew</h2>
            <table className="grid plain">
              <thead><tr><th>Prefix</th><th>Name</th><th>Email</th><th className="a-r">Trees</th></tr></thead>
              <tbody>
                {crew.map((u) => (
                  <tr key={u.id} className={u.id === me.sub ? 'sel' : ''}>
                    <td><span className="prefix-chip">{u.tagPrefix}</span></td><td>{u.name}{u.id === me.sub ? <span className="muted"> (you)</span> : ''}</td>
                    <td className="muted">{u.email}</td><td className="a-r">{treesBy.get(u.id)?.n ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">New cruisers sign up at <a href="/signup">/signup</a> and pick a prefix. Everyone signed in sees the whole crew&apos;s data.</p>
          </section>

          <section className="card">
            <h2>Devices seen</h2>
            <table className="grid plain" data-testid="devices">
              <thead><tr><th>Device</th><th>Cruiser</th><th className="a-r">Events</th><th>Last sync</th></tr></thead>
              <tbody>
                {devs.map((d) => {
                  const u = userBy.get(d.userId);
                  return (
                    <tr key={d.id}>
                      <td><b>{d.name ?? d.id}</b><div className="muted mono small">{d.id}</div></td>
                      <td>{u ? <><span className="prefix-chip sm">{u.tagPrefix}</span> {u.name}</> : '—'}</td>
                      <td className="a-r">{evBy.get(d.id)?.n ?? 0}</td>
                      <td>{ago(d.lastSeen)}</td>
                    </tr>
                  );
                })}
                {webEvents && (
                  <tr><td><b>Office dashboard</b><div className="muted mono small">web</div></td><td className="muted">all users</td><td className="a-r">{webEvents.n}</td><td>{ago(new Date(webEvents.last))}</td></tr>
                )}
                {!devs.length && <tr><td colSpan={4} className="empty">No field devices have synced yet.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>

        <section className="card">
          <h2>Connect the field app</h2>
          <ol className="steps">
            <li>On the iPhone, open <b>Timber Field</b> → <b>Settings</b> → <b>Server</b> and enter <code>{origin}</code>.</li>
            <li>Sign in with the same email and password you use here. The app calls <code>POST /api/auth/token</code> and stores a 30-day bearer token on the device.</li>
            <li>Tally offline all day. When the phone has signal, tap <b>Sync</b> (or it syncs automatically): it pushes new hash-chained events and pulls the crew&apos;s changes.</li>
          </ol>
          <details className="dev-details">
            <summary>API details for integrators</summary>
            <pre className="code">{`# Get a bearer token
curl -X POST ${origin}/api/auth/token \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"${me.email}","password":"…","deviceId":"my-phone","deviceName":"My iPhone"}'

# Push events (idempotent; each event hash is re-verified)
curl -X POST ${origin}/api/sync/push -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' -d '{"deviceId":"my-phone","events":[…]}'

# Pull everything since a cursor
curl "${origin}/api/sync/pull?since=0" -H "Authorization: Bearer $TOKEN"`}</pre>
          </details>
        </section>
      </main>
    </div>
  );
}
