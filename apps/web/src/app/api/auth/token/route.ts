import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db';
import { SESSION_TTL_S, signSession } from '@/lib/jwt';
import { readJson, route } from '@/lib/server/http';
import { touchDevice } from '@/lib/server/sync';
import { authenticate } from '@/lib/server/users';

const body = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().min(1).max(200).optional(),
  deviceName: z.string().max(200).optional(),
});

/** Field app login: returns a bearer token (same JWT as the dashboard cookie). */
export const POST = route(async (req) => {
  const input = body.parse(await readJson(req));
  const db = getDb();
  const user = await authenticate(db, input.email, input.password);
  if (input.deviceId && input.deviceId !== 'web') await touchDevice(db, input.deviceId, user.id, input.deviceName);
  const token = await signSession({ sub: user.id, email: user.email, name: user.name, prefix: user.tagPrefix });
  return NextResponse.json({ token, tokenType: 'Bearer', expiresIn: SESSION_TTL_S, user });
});
