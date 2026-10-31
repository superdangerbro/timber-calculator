import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { uuid } from '@timber/core';
import { getDb } from '@/db';
import { blocks } from '@/db/schema';
import { readJson, requireUser, route } from '@/lib/server/http';
import { rowToBlock } from '@/lib/server/rows';
import { upsertBlocks } from '@/lib/server/sync';
import { geometrySchema } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  await requireUser(req);
  const rows = await getDb().select().from(blocks).orderBy(asc(blocks.name));
  return NextResponse.json({ blocks: rows.map(rowToBlock) });
});

const body = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  code: z.string().max(20).optional().nullable(),
  boundary: geometrySchema,
});

export const POST = route(async (req) => {
  const s = await requireUser(req);
  const input = body.parse(await readJson(req));
  const id = input.id ?? uuid();
  const db = getDb();
  await upsertBlocks(db, s.sub, [{ ...input, id, code: input.code ?? undefined, createdBy: s.sub, createdAt: new Date().toISOString() } as never]);
  const [row] = await db.select().from(blocks).where(eq(blocks.id, id));
  return NextResponse.json({ block: rowToBlock(row) }, { status: 201 });
});
