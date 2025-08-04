import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getOAuth2Client } from './google-drive'

export async function getUserGoogleTokens() {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) return null
  
  const { data: tokens } = await supabase
    .from('google_tokens')
    .select('*')
    .eq('user_id', session.user.id)
    .single()
  
  if (!tokens) return null
  
  // Check if expired and refresh if needed
  if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
    if (!tokens.refresh_token) {
      // Can't refresh without refresh token
      return null
    }

    try {
      const oauth2Client = getOAuth2Client()
      oauth2Client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
      })
      
      const { credentials } = await oauth2Client.refreshAccessToken()
      
      // Update in database
      await supabase
        .from('google_tokens')
        .update({
          access_token: credentials.access_token!,
          expiry_date: credentials.expiry_date || null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', session.user.id)
      
      return {
        access_token: credentials.access_token!,
        refresh_token: credentials.refresh_token || tokens.refresh_token,
        expiry_date: credentials.expiry_date || null
      }
    } catch (error) {
      console.error('Failed to refresh token:', error)
      return null
    }
  }
  
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date
  }
}

export async function saveUserGoogleTokens(userId: string, tokens: any) {
  const supabase = createRouteHandlerClient({ cookies })
  
  const { error } = await supabase
    .from('google_tokens')
    .upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString()
    })
  
  if (error) {
    console.error('Error saving Google tokens:', error)
    throw error
  }
}

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