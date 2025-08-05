import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  
  // This is important - it refreshes the session and ensures cookies are properly set
  const { data: { session } } = await supabase.auth.getSession()
  
  // Protected routes that require authentication
  const protectedRoutes = ['/', '/knowledge-map', '/knowledgemapschema']
  const authRoutes = ['/login', '/signup']
  
  const isProtectedRoute = protectedRoutes.some(route => req.nextUrl.pathname === route)
  const isAuthRoute = authRoutes.some(route => req.nextUrl.pathname === route)
  
  // Redirect to login if accessing protected route without session
  if (isProtectedRoute && !session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  
  // Redirect to home if accessing auth routes with session
  if (isAuthRoute && session) {
    return NextResponse.redirect(new URL('/', req.url))
  }
  
  return res
}

// Run middleware on all routes except static files and api/auth/google routes
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth/google (Google OAuth routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api/auth/google|_next/static|_next/image|favicon.ico).*)',
  ]
}