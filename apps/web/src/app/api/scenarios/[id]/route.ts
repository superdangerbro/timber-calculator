import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { scenarios } from '@/db/schema';
import { readJson, requireUser, route } from '@/lib/server/http';
import { rowToScenario } from '@/lib/server/rows';
import { HttpError } from '@/lib/server/sync';
import { scenarioBody } from '../schema';

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route(async (req, ctx: Ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  const input = scenarioBody.parse(await readJson(req));
  const updatedAt = new Date().toISOString();
  const [row] = await getDb().update(scenarios)
    .set({ name: input.name, data: { ...input, id, updatedAt }, updatedAt })
    .where(eq(scenarios.id, id)).returning();
  if (!row) throw new HttpError(404, 'Scenario not found');
  return NextResponse.json({ scenario: rowToScenario(row) });
});

export const DELETE = route(async (req, ctx: Ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  await getDb().delete(scenarios).where(eq(scenarios.id, id));
  return NextResponse.json({ ok: true });
});
