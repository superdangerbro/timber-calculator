import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { requireUser, route } from '@/lib/server/http';
import { listTrees } from '@/lib/server/sync';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  await requireUser(req);
  return NextResponse.json({ trees: await listTrees(getDb()) });
});
