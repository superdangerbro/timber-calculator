import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { readJson, requireUser, route } from '@/lib/server/http';
import { pushEvents } from '@/lib/server/sync';

export const maxDuration = 60;

export const POST = route(async (req) => {
  const s = await requireUser(req);
  const result = await pushEvents(getDb(), s.sub, await readJson(req));
  return NextResponse.json(result);
});
