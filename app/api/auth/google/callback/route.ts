import { NextRequest, NextResponse } from 'next/server'
import { getTokenFromCode } from '@/lib/google-drive'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  
  if (!code) {
    console.error('No authorization code received')
    return NextResponse.redirect(new URL('/knowledge-map', request.nextUrl.origin))
  }
  
  try {
    // Exchange code for tokens
    const tokens = await getTokenFromCode(code)
    console.log('Got tokens:', { access_token: !!tokens.access_token, refresh_token: !!tokens.refresh_token })
    
    // Store tokens in cookies (NOT tied to Supabase user)
    const response = NextResponse.redirect(new URL('/knowledge-map', request.nextUrl.origin))
    response.cookies.set('google_tokens', JSON.stringify(tokens), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    
    console.log('Tokens saved to cookies successfully')
    
    return response
  } catch (error) {
    console.error('OAuth callback error:', error)
    // Even on error, redirect to knowledge-map
    return NextResponse.redirect(new URL('/knowledge-map', request.nextUrl.origin))
  }
}