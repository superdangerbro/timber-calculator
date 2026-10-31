import { Dashboard } from '@/components/dashboard/Dashboard';
import { requirePageSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await requirePageSession();
  return <Dashboard me={{ id: s.sub, name: s.name, email: s.email, prefix: s.prefix }} />;
}
