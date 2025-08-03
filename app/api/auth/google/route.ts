import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google-drive'

export async function GET() {
  const authUrl = getAuthUrl()
  return NextResponse.redirect(authUrl)
}