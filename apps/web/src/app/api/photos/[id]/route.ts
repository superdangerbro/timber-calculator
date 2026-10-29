import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { requireUser, route } from '@/lib/server/http';
import { getPhoto, putPhoto } from '@/lib/server/photos';

type Ctx = { params: Promise<{ id: string }> };

/** Upload a tree photo's bytes (raw body). Headers: Content-Type, X-Sha256, optional X-Tree-Id. */
export const PUT = route(async (req: Request, ctx: Ctx) => {
  const s = await requireUser(req);
  const { id } = await ctx.params;
  const data = new Uint8Array(await req.arrayBuffer());
  const result = await putPhoto(getDb(), {
    id,
    data,
    contentType: req.headers.get('content-type') ?? '',
    sha256: req.headers.get('x-sha256') ?? '',
    treeId: req.headers.get('x-tree-id'),
    userId: s.sub,
  });
  return NextResponse.json(result, { status: result.existed ? 200 : 201 });
});

export const GET = route(async (req: Request, ctx: Ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  const row = await getPhoto(getDb(), id);
  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': row.contentType,
      'Content-Length': String(row.bytes),
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: `"${row.sha256}"`,
    },
  });
});

export const HEAD = route(async (req: Request, ctx: Ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  const row = await getPhoto(getDb(), id);
  return new Response(null, { headers: { 'Content-Type': row.contentType, 'Content-Length': String(row.bytes), ETag: `"${row.sha256}"` } });
});
