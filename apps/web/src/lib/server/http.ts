import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { sessionFromRequest, type SessionClaims } from '@/lib/jwt';
import { HttpError } from './sync';

export async function requireUser(req: Request): Promise<SessionClaims> {
  const s = await sessionFromRequest(req);
  if (!s) throw new HttpError(401, 'Not signed in');
  return s;
}

export async function readJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { throw new HttpError(400, 'Body must be JSON'); }
}

/** Wraps a route handler: maps HttpError/ZodError to JSON error responses. */
export function route<A extends unknown[]>(fn: (req: Request, ...args: A) => Promise<Response>) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: 'Invalid input', issues: e.issues }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  };
}
