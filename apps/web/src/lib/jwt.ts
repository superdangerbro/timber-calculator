// Edge-safe JWT helpers (used by middleware and route handlers).
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'timber_session';
export const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days

export interface SessionClaims {
  sub: string; // user id
  email: string;
  name: string;
  prefix: string;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET is not set (min 16 chars)');
  return new TextEncoder().encode(s);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, name: claims.name, prefix: claims.prefix })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('timber-calculator')
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'timber-calculator' });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      prefix: String(payload.prefix ?? ''),
    };
  } catch {
    return null;
  }
}

/** Reads the session from the cookie or an `Authorization: Bearer` header. */
export async function sessionFromRequest(req: Request & { cookies?: { get(name: string): { value: string } | undefined } }) {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return verifySession(auth.slice(7).trim());
  const cookie = req.cookies?.get(SESSION_COOKIE)?.value ?? parseCookie(req.headers.get('cookie'), SESSION_COOKIE);
  return verifySession(cookie);
}

function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
