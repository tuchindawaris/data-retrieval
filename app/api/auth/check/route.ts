import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = cookies()
  const tokensCookie = cookieStore.get('google_tokens')
  
  if (!tokensCookie) {
    return NextResponse.json({ authenticated: false })
  }
  
  try {
    const tokens = JSON.parse(tokensCookie.value)
    return NextResponse.json({ 
      authenticated: true,
      token: tokens.access_token 
    })
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}