import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

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