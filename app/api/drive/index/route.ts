import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { listFolderContents, getFileMetadata } from '@/lib/google-drive'
import { getUserGoogleTokens, getUserDriveSource } from '@/lib/google-tokens'
import { processSpreadsheet } from '@/lib/spreadsheet-processor'

// Check if file is a spreadsheet
function isSpreadsheet(mimeType: string, fileName: string): boolean {
  const spreadsheetMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.oasis.opendocument.spreadsheet'
  ]
  
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  const spreadsheetExtensions = ['xlsx', 'xls', 'csv', 'ods']
  
  return spreadsheetMimeTypes.includes(mimeType) || spreadsheetExtensions.includes(extension)
}

// Check if file is a document
function isDocument(mimeType: string, fileName: string): boolean {
  const documentMimeTypes = [
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.google-apps.document',
    'application/rtf',
    'application/vnd.oasis.opendocument.text'
  ]
  
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  const documentExtensions = ['txt', 'md', 'doc', 'docx', 'rtf', 'odt']
  
  return documentMimeTypes.includes(mimeType) || documentExtensions.includes(extension)
}

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
    
    // Process spreadsheets to extract column metadata
    let fileMetadata: any = {
      modifiedTime: file.modifiedTime,
      parents: file.parents,
      isFolder: file.mimeType === 'application/vnd.google-apps.folder',
      parentFolderId: folderId,
    }
    
    if (!fileMetadata.isFolder && isSpreadsheet(file.mimeType!, file.name!)) {
      try {
        console.log(`Processing spreadsheet: ${file.name} (${file.id})`)
        const sheetsMetadata = await processSpreadsheet(
          accessToken,
          file.id!,
          file.name!,
          file.mimeType!
        )
        
        fileMetadata.isSpreadsheet = true
        fileMetadata.sheets = sheetsMetadata
        fileMetadata.processedAt = new Date().toISOString()
      } catch (error: any) {
        console.error(`Error processing spreadsheet ${file.name}:`, error)
        fileMetadata.spreadsheetError = error.message || String(error)
      }
    } else if (!fileMetadata.isFolder && isDocument(file.mimeType!, file.name!)) {
      fileMetadata.isDocument = true
    }
    
    // Add all files (including folders) to records
    fileRecords.push({
      source_id: sourceId,
      file_id: file.id!,
      name: file.name!,
      mime_type: file.mimeType!,
      size: parseInt(file.size || '0'),
      folder_path: currentPath,
      metadata: fileMetadata,
    })
  }
  
  return fileRecords
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { folderId, generateSummaries = false } = await request.json()
    
    // Get Google tokens
    const tokens = await getUserGoogleTokens()
    if (!tokens) {
      return NextResponse.json({ error: 'Not authenticated with Google Drive' }, { status: 401 })
    }
    
    // Get or create Drive source
    const source = await getUserDriveSource(session.user.id)
    if (!source) {
      return NextResponse.json({ error: 'Failed to get Drive source' }, { status: 500 })
    }
    
    const sourceId = source.id
    
    // Check if folder already indexed
    const { data: existingFiles } = await supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', sourceId)
      .eq('file_id', folderId)
      .eq('metadata->>isFolder', 'true')
      .limit(1)
    
    if (existingFiles && existingFiles.length > 0) {
      // Folder exists - do a resync
      // First, delete all existing files for this folder
      const { data: allFiles } = await supabase
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
        await supabase
          .from('file_metadata')
          .delete()
          .in('id', idsToDelete)
      }
    }
    
    // Index folder recursively
    const fileRecords = await indexFolderRecursive(
      tokens.access_token,
      folderId,
      folderId,
      sourceId
    )
    
    // Get folder metadata for the root folder
    const folderMeta = await getFileMetadata(tokens.access_token, folderId)
    
    // Add the root folder
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
      await supabase
        .from('file_metadata')
        .upsert(fileRecords, { onConflict: 'source_id,file_id' })
    }
    
    // Generate summaries if requested
    let summaryCount = 0
    if (generateSummaries) {
      try {
        const baseUrl = request.nextUrl.origin
        const summaryResponse = await fetch(
          `${baseUrl}/api/drive/generate-summaries`,
          {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Cookie': request.headers.get('cookie') || ''
            },
            body: JSON.stringify({ folderId })
          }
        )
        
        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json()
          summaryCount = summaryData.updated || 0
        }
      } catch (error) {
        console.error('Error generating summaries:', error)
      }
    }
    
    const resynced = existingFiles && existingFiles.length > 0
    
    return NextResponse.json({ 
      success: true,
      resynced,
      indexed: fileRecords.length,
      summariesGenerated: summaryCount
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
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { folderId, clearAll } = await request.json()
    
    // Get Drive source
    const source = await getUserDriveSource(session.user.id)
    if (!source) {
      return NextResponse.json({ error: 'No drive source found' }, { status: 404 })
    }
    
    if (clearAll) {
      // Delete all files for this source
      await supabase
        .from('file_metadata')
        .delete()
        .eq('source_id', source.id)
    } else if (folderId) {
      // Delete specific folder and all its contents
      const { data: files } = await supabase
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
        await supabase
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