import { z } from 'zod';
import { getDb } from '@/db';
import { readJson, route } from '@/lib/server/http';
import { authenticate } from '@/lib/server/users';
import { sessionResponse } from '../session';

const body = z.object({ email: z.string().min(1), password: z.string().min(1) });

export const POST = route(async (req) => {
  const { email, password } = body.parse(await readJson(req));
  const user = await authenticate(getDb(), email, password);
  return sessionResponse(req, user);
});
