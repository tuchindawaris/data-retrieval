import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getOAuth2Client } from '@/lib/google-drive'
import { google } from 'googleapis'

export async function GET() {
  const cookieStore = cookies()
  const tokensCookie = cookieStore.get('google_tokens')
  
  if (!tokensCookie) {
    return NextResponse.json({ authenticated: false })
  }
  
  try {
    const tokens = JSON.parse(tokensCookie.value)
    
    // Check if token is expired and refresh if needed
    let accessToken = tokens.access_token
    let updatedTokens = tokens
    
    if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
      console.log('Access token expired, attempting to refresh...')
      
      if (tokens.refresh_token) {
        const oauth2Client = getOAuth2Client()
        oauth2Client.setCredentials(tokens)
        
        try {
          const { credentials } = await oauth2Client.refreshAccessToken()
          updatedTokens = credentials
          accessToken = credentials.access_token
          
          // Update stored tokens
          cookieStore.set('google_tokens', JSON.stringify(credentials), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
          })
        } catch (error) {
          console.error('Failed to refresh token:', error)
          return NextResponse.json({ authenticated: false })
        }
      } else {
        console.log('No refresh token available')
        return NextResponse.json({ authenticated: false })
      }
    }
    
    // Get user info to retrieve email
    try {
      const oauth2Client = getOAuth2Client()
      oauth2Client.setCredentials(updatedTokens)
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
      
      const { data } = await oauth2.userinfo.get()
      
      return NextResponse.json({ 
        authenticated: true,
        token: accessToken,
        email: data.email,
        name: data.name
      })
    } catch (error) {
      console.error('Failed to get user info:', error)
      // Return authenticated but without email if userinfo fails
      return NextResponse.json({ 
        authenticated: true,
        token: accessToken 
      })
    }
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}