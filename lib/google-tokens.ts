import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

// NOTE: This file is simplified - Google tokens are now stored in cookies
// independently of Supabase authentication

export async function getUserDriveSource(userId?: string) {
  const supabase = createRouteHandlerClient({ cookies })
  
  // If no userId provided, get from session
  if (!userId) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    userId = session.user.id
  }
  
  // Get or create Drive source for user
  let { data: source } = await supabase
    .from('data_sources')
    .select('*')
    .eq('user_id', userId)
    .eq('type', 'drive')
    .single()
  
  if (!source) {
    const { data: newSource, error } = await supabase
      .from('data_sources')
      .insert({ 
        user_id: userId,
        name: 'Google Drive',
        type: 'drive'
      })
      .select()
      .single()
    
    if (error) {
      console.error('Error creating Drive source:', error)
      return null
    }
    
    source = newSource
  }
  
  return source
}