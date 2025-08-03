import { NextRequest, NextResponse } from 'next/server'
import { listFolderContents, getFileMetadata } from '@/lib/google-drive'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'

async function indexFolderRecursive(
  accessToken: string, 
  folderId: string, 
  folderPath: string,
  sourceId: string,
  parentName: string = ''
) {
  const files = await listFolderContents(accessToken, folderId)
  const fileRecords = []
  
  for (const file of files) {
    const currentPath = parentName ? `${folderPath}/${parentName}` : folderPath
    
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      // Recursively index subfolders
      const subRecords = await indexFolderRecursive(
        accessToken,
        file.id!,
        currentPath,
        sourceId,
        file.name!
      )
      fileRecords.push(...subRecords)
    }
    
    // Add all files (including folders) to records
    fileRecords.push({
      source_id: sourceId,
      file_id: file.id!,
      name: file.name!,
      mime_type: file.mimeType!,
      size: parseInt(file.size || '0'),
      folder_path: currentPath,
      metadata: {
        modifiedTime: file.modifiedTime,
        parents: file.parents,
        isFolder: file.mimeType === 'application/vnd.google-apps.folder',
        parentFolderId: folderId,
      },
    })
  }
  
  return fileRecords
}

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
    
    // Check if folder already indexed
    const { data: existingFiles } = await supabaseAdmin
      .from('file_metadata')
      .select('*')
      .eq('source_id', sourceId)
      .eq('file_id', folderId)
      .eq('metadata->>isFolder', 'true')
      .limit(1)
    
    if (existingFiles && existingFiles.length > 0) {
      // Folder exists - do a resync
      // First, delete all existing files for this folder
      const { data: allFiles } = await supabaseAdmin
        .from('file_metadata')
        .select('*')
        .eq('source_id', sourceId)
      
      const filesToDelete = allFiles?.filter(file => 
        file.file_id === folderId ||
        file.folder_path === folderId || 
        file.folder_path.startsWith(`${folderId}/`) ||
        file.metadata?.parentFolderId === folderId
      ) || []
      
      if (filesToDelete.length > 0) {
        const idsToDelete = filesToDelete.map(f => f.id)
        await supabaseAdmin
          .from('file_metadata')
          .delete()
          .in('id', idsToDelete)
      }
      
      // Now re-index the folder with fresh data
      const fileRecords = await indexFolderRecursive(
        accessToken,
        folderId,
        folderId,
        sourceId
      )
      
      // Add the root folder
      const folderMeta = await getFileMetadata(accessToken, folderId)
      fileRecords.unshift({
        source_id: sourceId,
        file_id: folderId,
        name: folderMeta.name || 'Untitled Folder',
        mime_type: 'application/vnd.google-apps.folder',
        size: 0,
        folder_path: 'root',
        metadata: {
          modifiedTime: folderMeta.modifiedTime,
          parents: folderMeta.parents || [],
          isFolder: true,
          parentFolderId: null,
        },
      })
      
      if (fileRecords.length > 0) {
        await supabaseAdmin
          .from('file_metadata')
          .upsert(fileRecords, { onConflict: 'source_id,file_id' })
      }
      
      return NextResponse.json({ 
        success: true,
        resynced: true,
        indexed: fileRecords.length 
      })
    }
    
    // Index folder recursively
    const fileRecords = await indexFolderRecursive(
      accessToken,
      folderId,
      folderId,
      sourceId
    )
    
    // Add the root folder itself if it's not already in records
    const rootFolderExists = fileRecords.some(f => f.file_id === folderId)
    if (!rootFolderExists) {
      // Get root folder metadata
      const folderMeta = await getFileMetadata(accessToken, folderId)
      
      fileRecords.unshift({
        source_id: sourceId,
        file_id: folderId,
        name: folderMeta.name || 'Untitled Folder',
        mime_type: 'application/vnd.google-apps.folder',
        size: 0,
        folder_path: 'root',
        metadata: {
          modifiedTime: folderMeta.modifiedTime,
          parents: folderMeta.parents || [],
          isFolder: true,
          parentFolderId: null,
        },
      })
    }
    
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

export async function DELETE(request: NextRequest) {
  try {
    const { folderId, clearAll } = await request.json()
    
    // Get Drive source
    const { data: source } = await supabaseAdmin
      .from('data_sources')
      .select('*')
      .eq('type', 'drive')
      .single()
    
    if (!source) {
      return NextResponse.json({ error: 'No drive source found' }, { status: 404 })
    }
    
    if (clearAll) {
      // Delete all files for this source
      await supabaseAdmin
        .from('file_metadata')
        .delete()
        .eq('source_id', source.id)
    } else if (folderId) {
      // Delete specific folder and all its contents
      const { data: files } = await supabaseAdmin
        .from('file_metadata')
        .select('*')
        .eq('source_id', source.id)
      
      // Find all files that belong to this folder or its subfolders
      const filesToDelete = files?.filter(file => 
        file.file_id === folderId || // The folder itself
        file.folder_path === folderId || 
        file.folder_path.startsWith(`${folderId}/`) ||
        file.metadata?.parentFolderId === folderId
      ) || []
      
      if (filesToDelete.length > 0) {
        const idsToDelete = filesToDelete.map(f => f.id)
        await supabaseAdmin
          .from('file_metadata')
          .delete()
          .in('id', idsToDelete)
      }
    }
    
    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete files' }, 
      { status: 500 }
    )
  }
}