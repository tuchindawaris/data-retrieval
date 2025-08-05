import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

export async function POST() {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient({ cookies })
  
  // Sign out from Supabase (this will clear the auth cookies properly)
  await supabase.auth.signOut()
  
  // Also clear any Google tokens
  cookieStore.delete('google_tokens')
  
  // Get all cookies and clear any remaining auth-related ones
  const allCookies = cookieStore.getAll()
  
  // Clear any Supabase cookies that might remain
  const supabaseCookies = allCookies.filter(c => 
    c.name.startsWith('sb-') || 
    c.name.includes('supabase')
  )
  
  // Clear each one
  supabaseCookies.forEach(cookie => {
    cookieStore.delete(cookie.name)
  })
  
  return NextResponse.json({ 
    cleared: supabaseCookies.map(c => c.name),
    message: 'Cleared all auth cookies'
  })
}