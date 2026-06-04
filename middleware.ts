import { NextRequest, NextResponse } from 'next/server';

const APP_PASSWORD = process.env.APP_PASSWORD;
const COOKIE_NAME = 'pullplan_auth';

// Routes that don't need password protection
const PUBLIC_PATHS = ['/api/auth/login'];

export function middleware(req: NextRequest) {
  // Skip if no password is set (local dev without APP_PASSWORD)
  if (!APP_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Always allow the login API
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for valid auth cookie
  const cookie = req.cookies.get(COOKIE_NAME);
  if (cookie?.value === APP_PASSWORD) {
    return NextResponse.next();
  }

  // Serve the login page for all other routes
  if (pathname === '/login') return NextResponse.next();

  // Redirect to login
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
