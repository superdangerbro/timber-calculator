import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { requireUser, route } from '@/lib/server/http';
import { pullEvents } from '@/lib/server/sync';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  await requireUser(req);
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 2000) || 2000, 1), 5000);
  return NextResponse.json(await pullEvents(getDb(), url.searchParams.get('since'), limit));
});
