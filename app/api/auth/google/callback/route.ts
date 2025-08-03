import { NextRequest, NextResponse } from 'next/server'
import { getTokenFromCode } from '@/lib/google-drive'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  
  if (!code) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  
  try {
    const tokens = await getTokenFromCode(code)
    
    // In production, store tokens securely
    // For now, we'll pass them to the client
    const response = NextResponse.redirect(new URL('/', request.url))
    response.cookies.set('google_tokens', JSON.stringify(tokens), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    
    return response
  } catch (error) {
    console.error('OAuth error:', error)
    return NextResponse.redirect(new URL('/', request.url))
  }
}