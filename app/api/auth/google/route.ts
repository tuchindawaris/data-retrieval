import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google-drive'

export async function GET() {
  try {
    const authUrl = getAuthUrl()
    console.log('Google Auth: Redirecting to:', authUrl)
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Google Auth Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate Google auth URL' },
      { status: 500 }
    )
  }
}