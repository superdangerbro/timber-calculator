import { Report } from '@/components/report/Report';
import { requirePageSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cruise summary report' };

export default async function ReportPage() {
  const s = await requirePageSession();
  return <Report me={{ name: s.name }} />;
}
