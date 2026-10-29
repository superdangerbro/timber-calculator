import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { blocks } from '@/db/schema';
import { requireUser, route } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route(async (req, ctx: Ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  await getDb().delete(blocks).where(eq(blocks.id, id));
  return NextResponse.json({ ok: true });
});
