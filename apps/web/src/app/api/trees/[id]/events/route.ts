import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { readJson, requireUser, route } from '@/lib/server/http';
import { appendWebEvent, treeHistory } from '@/lib/server/sync';
import { treeEditSchema } from '@/lib/server/validate';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/** History of one tree, with chain verification. */
export const GET = route(async (req, ctx: Ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  return NextResponse.json(await treeHistory(getDb(), id));
});

/** Dashboard edit: appends an update / void / status event by the signed-in user (deviceId "web"). */
export const POST = route(async (req, ctx: Ctx) => {
  const s = await requireUser(req);
  const { id } = await ctx.params;
  const edit = treeEditSchema.parse(await readJson(req));
  const result = await appendWebEvent(getDb(), s.sub, id, edit.type, edit.payload as Record<string, unknown>);
  return NextResponse.json(result, { status: 201 });
});
