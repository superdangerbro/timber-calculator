import { z } from 'zod';
import { getDb } from '@/db';
import { readJson, route } from '@/lib/server/http';
import { createUser } from '@/lib/server/users';
import { sessionResponse } from '../session';

const body = z.object({
  email: z.string().email(),
  name: z.string().max(100).default(''),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  tagPrefix: z.string().max(3).optional(),
});

export const POST = route(async (req) => {
  const input = body.parse(await readJson(req));
  const user = await createUser(getDb(), input);
  return sessionResponse(req, user, 201);
});
