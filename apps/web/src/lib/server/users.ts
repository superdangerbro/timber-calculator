import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { users } from '@/db/schema';
import { HttpError } from './sync';
import type { UserProfile } from '@timber/core';

export function toProfile(u: typeof users.$inferSelect): UserProfile {
  return { id: u.id, email: u.email, name: u.name, tagPrefix: u.tagPrefix };
}

export async function createUser(db: DB, input: { email: string; name: string; password: string; tagPrefix?: string }) {
  const email = input.email.trim().toLowerCase();
  const [dupe] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (dupe) throw new HttpError(409, 'An account with that email already exists');
  let prefix = (input.tagPrefix ?? '').trim().toUpperCase();
  if (prefix) {
    if (!/^[A-Z]{1,3}$/.test(prefix)) throw new HttpError(400, 'Tag prefix must be 1-3 letters');
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.tagPrefix, prefix));
    if (taken) throw new HttpError(409, `Tag prefix ${prefix} is already used by another cruiser`);
  } else {
    prefix = await suggestPrefix(db, input.name || email);
  }
  const passwordHash = await bcrypt.hash(input.password, 10);
  const [u] = await db.insert(users).values({ email, name: input.name.trim() || email, passwordHash, tagPrefix: prefix }).returning();
  return toProfile(u);
}

/** First free single letter from the name, then any free letter, then two letters. */
export async function suggestPrefix(db: DB, name: string): Promise<string> {
  const taken = new Set((await db.select({ p: users.tagPrefix }).from(users)).map((r) => r.p));
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  for (const c of letters) if (!taken.has(c)) return c;
  for (const c of 'ABCDEFGHJKMNPRTUVWXYZ') if (!taken.has(c)) return c;
  for (const a of 'ABCDEFGHJKMNPRTUVWXYZ') for (const b of 'ABCDEFGHJKMNPRTUVWXYZ') if (!taken.has(a + b)) return a + b;
  throw new HttpError(500, 'No tag prefixes left');
}

export async function authenticate(db: DB, email: string, password: string) {
  const [u] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()));
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, 'Wrong email or password');
  return toProfile(u);
}

export async function listUsers(db: DB): Promise<UserProfile[]> {
  return (await db.select().from(users)).map(toProfile);
}
