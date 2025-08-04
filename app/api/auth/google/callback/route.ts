import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getTokenFromCode } from '@/lib/google-drive'
import { saveUserGoogleTokens } from '@/lib/google-tokens'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  
  if (!code) {
    console.error('No authorization code received')
    return NextResponse.redirect(new URL('/knowledge-map', request.nextUrl.origin))
  }
  
  try {
    // Get current user
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      console.error('No active session in callback')
      return NextResponse.redirect(new URL('/login', request.nextUrl.origin))
    }
    
    // Exchange code for tokens
    const tokens = await getTokenFromCode(code)
    console.log('Got tokens:', { access_token: !!tokens.access_token, refresh_token: !!tokens.refresh_token })
    
    // Save tokens to database
    await saveUserGoogleTokens(session.user.id, tokens)
    console.log('Tokens saved successfully')
    
    // Always redirect to knowledge-map
    return NextResponse.redirect(new URL('/knowledge-map', request.nextUrl.origin))
  } catch (error) {
    console.error('OAuth callback error:', error)
    // Even on error, redirect to knowledge-map
    return NextResponse.redirect(new URL('/knowledge-map', request.nextUrl.origin))
  }
}