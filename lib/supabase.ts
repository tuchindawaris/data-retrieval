import { createClient } from '@supabase/supabase-js'

// Debug: Check if environment variables are loaded
console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
console.log('Supabase Anon Key:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
console.log('Supabase Service Key exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Check if the required keys exist before creating clients
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required Supabase environment variables')
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl)
  console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseAnonKey)
  throw new Error('Missing required Supabase environment variables. Please check your .env.local file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Only create admin client if service key exists
export const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null as any

export type DataSource = {
  id: string
  name: string
  type: 'sql' | 'drive'
  connection_info: any
  created_at: string
  updated_at: string
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