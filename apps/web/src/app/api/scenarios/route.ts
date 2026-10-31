import { NextResponse } from 'next/server';
import { asc } from 'drizzle-orm';
import { uuid } from '@timber/core';
import { getDb } from '@/db';
import { scenarios } from '@/db/schema';
import { readJson, requireUser, route } from '@/lib/server/http';
import { rowToScenario } from '@/lib/server/rows';
import { scenarioBody } from './schema';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  await requireUser(req);
  const rows = await getDb().select().from(scenarios).orderBy(asc(scenarios.createdAt));
  return NextResponse.json({ scenarios: rows.map(rowToScenario) });
});

export const POST = route(async (req) => {
  const s = await requireUser(req);
  const input = scenarioBody.parse(await readJson(req));
  const id = uuid();
  const updatedAt = new Date().toISOString();
  const data = { ...input, id, updatedAt };
  const [row] = await getDb().insert(scenarios).values({ id, name: input.name, data, createdBy: s.sub, updatedAt }).returning();
  return NextResponse.json({ scenario: rowToScenario(row) }, { status: 201 });
});
