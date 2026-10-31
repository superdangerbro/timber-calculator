import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders } from './lib/cors';
import { SESSION_COOKIE, verifySession } from './lib/jwt';

const PUBLIC_PAGES = ['/login', '/signup'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin');

  if (pathname.startsWith('/api/')) {
    // API routes authenticate themselves (cookie or bearer); middleware only handles CORS.
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers: cors });
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (PUBLIC_PAGES.includes(pathname)) {
    if (session) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }
  if (!session) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
};
