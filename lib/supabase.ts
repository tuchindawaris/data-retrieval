/**
 * @deprecated Do not use this file for authentication
 * 
 * Use these instead:
 * - Client Components: createClientComponentClient from @supabase/auth-helpers-nextjs
 * - Server Components: createServerComponentClient from @supabase/auth-helpers-nextjs  
 * - Route Handlers: createRouteHandlerClient from @supabase/auth-helpers-nextjs
 * - Middleware: createMiddlewareClient from @supabase/auth-helpers-nextjs
 * 
 * These auth-helpers ensure consistent cookie handling between client and server.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// This client should NOT be used for authentication
// Only use for non-authenticated operations if needed
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)

// Type definitions (these can still be used)
export type DataSource = {
  id: string
  name: string
  type: 'sql' | 'drive'
  connection_info: any
  created_at: string
  updated_at: string
  user_id: string
}

export type FileMetadata = {
  id: string
  source_id: string
  file_id: string
  name: string
  mime_type: string
  size: number
  folder_path: string
  metadata: any
  indexed_at: string
  updated_at: string
}

export type SchemaMetadata = {
  id: string
  source_id: string
  table_name: string
  column_name: string
  data_type: string
  is_nullable: boolean
  metadata: any
  created_at: string
}