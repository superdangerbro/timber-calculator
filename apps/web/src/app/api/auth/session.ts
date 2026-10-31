import { NextResponse } from 'next/server';
import type { UserProfile } from '@timber/core';
import { SESSION_COOKIE, SESSION_TTL_S, signSession } from '@/lib/jwt';

export async function sessionResponse(req: Request, user: UserProfile, status = 200) {
  const token = await signSession({ sub: user.id, email: user.email, name: user.name, prefix: user.tagPrefix });
  const res = NextResponse.json({ user }, { status });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_S,
    secure: new URL(req.url).protocol === 'https:',
  });
  return res;
}
