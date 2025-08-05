import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  const cookieStore = cookies()
  
  // Clear Google tokens
  cookieStore.delete('google_tokens')
  
  return NextResponse.json({ 
    success: true,
    message: 'Successfully disconnected from Google Drive'
  })
}