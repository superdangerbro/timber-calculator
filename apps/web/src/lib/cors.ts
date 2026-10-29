// CORS for the field app (Capacitor iOS serves from capacitor://localhost; dev from http://localhost:*).
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin === 'capacitor://localhost' || origin === 'ionic://localhost') return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Tree-Id, X-Sha256',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
