import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getTokenFromCode } from '@/lib/google-drive'
import { saveUserGoogleTokens } from '@/lib/google-tokens'

export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  
  if (!code) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  
  try {
    const tokens = await getTokenFromCode(code)
    
    // Save tokens to database
    await saveUserGoogleTokens(session.user.id, tokens)
    
    return NextResponse.redirect(new URL('/', request.url))
  } catch (error) {
    console.error('OAuth error:', error)
    return NextResponse.redirect(new URL('/', request.url))
  }
}