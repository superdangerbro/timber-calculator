import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { requireUser, route } from '@/lib/server/http';
import { listUsers } from '@/lib/server/users';

export const GET = route(async (req) => {
  await requireUser(req);
  return NextResponse.json({ users: await listUsers(getDb()) });
});
