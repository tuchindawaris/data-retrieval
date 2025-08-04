import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  
  // Refresh session if expired - required for Server Components
  await supabase.auth.getSession()
  
  return res
}

// Only run middleware on API routes and pages that need auth
export const config = {
  matcher: [
    '/api/drive/:path*',
    '/knowledge-map',
    '/knowledgemapschema',
    '/'
  ]
}