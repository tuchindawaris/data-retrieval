import { NextResponse } from 'next/server'
import { getUserGoogleTokens } from '@/lib/google-tokens'

export async function GET() {
  try {
    const tokens = await getUserGoogleTokens()
    
    if (!tokens) {
      return NextResponse.json({ authenticated: false })
    }
    
    return NextResponse.json({ 
      authenticated: true,
      token: tokens.access_token 
    })
  } catch (error) {
    console.error('Error checking auth:', error)
    return NextResponse.json({ authenticated: false })
  }
}