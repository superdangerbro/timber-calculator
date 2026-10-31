import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { requireUser, route } from '@/lib/server/http';
import { HttpError } from '@/lib/server/sync';
import { toProfile } from '@/lib/server/users';

export const GET = route(async (req) => {
  const s = await requireUser(req);
  const [u] = await getDb().select().from(users).where(eq(users.id, s.sub));
  if (!u) throw new HttpError(401, 'Account no longer exists');
  return NextResponse.json({ user: toProfile(u) });
});
