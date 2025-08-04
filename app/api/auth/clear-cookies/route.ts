import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  const cookieStore = cookies()
  
  // Get all cookies
  const allCookies = cookieStore.getAll()
  
  // Clear all Supabase auth tokens from other projects
  const supabaseCookies = allCookies.filter(c => 
    c.name.startsWith('sb-') && c.name.endsWith('-auth-token')
  )
  
  // Clear each one
  supabaseCookies.forEach(cookie => {
    cookieStore.delete(cookie.name)
  })
  
  // Also clear any other auth-related cookies
  const authCookies = ['sb-access-token', 'sb-refresh-token']
  authCookies.forEach(name => {
    cookieStore.delete(name)
  })
  
  return NextResponse.json({ 
    cleared: supabaseCookies.map(c => c.name),
    message: 'Cleared all Supabase auth cookies. Please log in again.'
  })
}