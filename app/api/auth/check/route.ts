import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getOAuth2Client } from '@/lib/google-drive'

export async function GET() {
  const cookieStore = cookies()
  const tokensCookie = cookieStore.get('google_tokens')
  
  if (!tokensCookie) {
    return NextResponse.json({ authenticated: false })
  }
  
  try {
    const tokens = JSON.parse(tokensCookie.value)
    
    // Check if token is expired and refresh if needed
    if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
      console.log('Access token expired, attempting to refresh...')
      
      if (tokens.refresh_token) {
        const oauth2Client = getOAuth2Client()
        oauth2Client.setCredentials(tokens)
        
        try {
          const { credentials } = await oauth2Client.refreshAccessToken()
          
          // Update stored tokens
          const response = NextResponse.json({ 
            authenticated: true,
            token: credentials.access_token 
          })
          
          response.cookies.set('google_tokens', JSON.stringify(credentials), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
          })
          
          return response
        } catch (error) {
          console.error('Failed to refresh token:', error)
          return NextResponse.json({ authenticated: false })
        }
      } else {
        console.log('No refresh token available')
        return NextResponse.json({ authenticated: false })
      }
    }
    
    return NextResponse.json({ 
      authenticated: true,
      token: tokens.access_token 
    })
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}