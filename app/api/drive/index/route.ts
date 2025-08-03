import { NextRequest, NextResponse } from 'next/server'
import { listFolderContents } from '@/lib/google-drive'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const { folderId } = await request.json()
    
    // Get tokens from cookie
    const cookieStore = cookies()
    const tokensCookie = cookieStore.get('google_tokens')
    if (!tokensCookie) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    const tokens = JSON.parse(tokensCookie.value)
    const accessToken = tokens.access_token
    
    // Get or create Drive source
    const { data: sources } = await supabaseAdmin
      .from('data_sources')
      .select('*')
      .eq('type', 'drive')
      .single()
    
    let sourceId = sources?.id
    if (!sourceId) {
      const { data: newSource } = await supabaseAdmin
        .from('data_sources')
        .insert({ name: 'Google Drive', type: 'drive', connection_info: {} })
        .select()
        .single()
      sourceId = newSource?.id
    }
    
    // List folder contents
    const files = await listFolderContents(accessToken, folderId)
    
    // Index files
    const fileRecords = files.map(file => ({
      source_id: sourceId,
      file_id: file.id!,
      name: file.name!,
      mime_type: file.mimeType!,
      size: parseInt(file.size || '0'),
      folder_path: folderId,
      metadata: {
        modifiedTime: file.modifiedTime,
        parents: file.parents,
      },
    }))
    
    if (fileRecords.length > 0) {
      await supabaseAdmin
        .from('file_metadata')
        .upsert(fileRecords, { onConflict: 'source_id,file_id' })
    }
    
    return NextResponse.json({ 
      success: true, 
      indexed: fileRecords.length 
    })
    
  } catch (error) {
    console.error('Indexing error:', error)
    return NextResponse.json(
      { error: 'Failed to index folder' }, 
      { status: 500 }
    )
  }
}