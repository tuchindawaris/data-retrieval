import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { listFolderContents, getFileMetadata } from '@/lib/google-drive'
import { processSpreadsheet } from '@/lib/spreadsheet-processor'
import { getOAuth2Client } from '@/lib/google-drive'

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

async function refreshTokenIfNeeded(tokens: any, cookieStore: any) {
  if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
    console.log('Access token expired, attempting to refresh...')
    
    if (tokens.refresh_token) {
      const oauth2Client = getOAuth2Client()
      oauth2Client.setCredentials(tokens)
      
      try {
        const { credentials } = await oauth2Client.refreshAccessToken()
        
        // Update stored tokens
        cookieStore.set('google_tokens', JSON.stringify(credentials), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7, // 7 days
        })
        
        console.log('Successfully refreshed Google access token')
        return credentials.access_token
      } catch (error) {
        console.error('Failed to refresh token:', error)
        throw new Error('Failed to refresh Google token')
      }
    } else {
      throw new Error('No refresh token available')
    }
  }
  
  return tokens.access_token
}

export async function POST(request: NextRequest) {
  console.log('\n=== DRIVE INDEX REQUEST ===')
  
  try {
    // Create Supabase client with the request/response
    const supabase = createRouteHandlerClient({ cookies })
    
    // Get the session - this should work with the middleware properly setting cookies
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ 
        error: 'Authentication error',
        details: sessionError.message 
      }, { status: 401 })
    }
    
    if (!session) {
      console.error('No session found')
      return NextResponse.json({ 
        error: 'Not authenticated - please log in' 
      }, { status: 401 })
    }
    
    console.log(`Authenticated user: ${session.user.email}`)
    
    const { folderId, generateSummaries = false } = await request.json()
    console.log(`Folder ID: ${folderId}, Generate summaries: ${generateSummaries}`)
    
    // Get Google tokens from cookies
    const cookieStore = cookies()
    const tokensCookie = cookieStore.get('google_tokens')
    
    if (!tokensCookie) {
      console.error('No Google tokens cookie found')
      return NextResponse.json({ 
        error: 'Not authenticated with Google Drive - please link Google Drive first' 
      }, { status: 401 })
    }
    
    let tokens
    try {
      tokens = JSON.parse(tokensCookie.value)
      console.log('Google tokens found, checking expiry...')
    } catch (e) {
      console.error('Failed to parse Google tokens:', e)
      return NextResponse.json({ 
        error: 'Invalid Google tokens - please re-link Google Drive' 
      }, { status: 401 })
    }
    
    // Refresh token if needed
    let accessToken
    try {
      accessToken = await refreshTokenIfNeeded(tokens, cookieStore)
      console.log('Google access token is valid')
    } catch (error: any) {
      console.error('Token refresh failed:', error)
      return NextResponse.json({ 
        error: 'Google token refresh failed - please re-link Google Drive', 
        details: error.message 
      }, { status: 401 })
    }
    
    // Get or create Drive source for the user
    console.log('Getting Drive source for user...')
    const { data: source, error: sourceError } = await supabase
      .from('data_sources')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('type', 'drive')
      .single()
    
    let sourceId = source?.id
    
    if (!sourceId) {
      console.log('Creating new Drive source...')
      const { data: newSource, error } = await supabase
        .from('data_sources')
        .insert({ 
          user_id: session.user.id,
          name: 'Google Drive',
          type: 'drive'
        })
        .select()
        .single()
      
      if (error) {
        console.error('Error creating Drive source:', error)
        return NextResponse.json({ 
          error: 'Failed to create Drive source', 
          details: error.message 
        }, { status: 500 })
      }
      
      sourceId = newSource?.id
      console.log('Created new Drive source:', sourceId)
    } else {
      console.log('Using existing Drive source:', sourceId)
    }
    
    // Check if folder already indexed
    const { data: existingFiles } = await supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', sourceId)
      .eq('file_id', folderId)
      .eq('metadata->>isFolder', 'true')
      .limit(1)
    
    if (existingFiles && existingFiles.length > 0) {
      console.log('Folder already indexed, performing resync...')
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
        console.log(`Deleting ${filesToDelete.length} existing files...`)
        const idsToDelete = filesToDelete.map(f => f.id)
        await supabase
          .from('file_metadata')
          .delete()
          .in('id', idsToDelete)
      }
    }
    
    // Index folder recursively
    console.log('Starting folder indexing...')
    const fileRecords = await indexFolderRecursive(
      accessToken,
      folderId,
      folderId,
      sourceId
    )
    
    // Get folder metadata for the root folder
    console.log('Getting root folder metadata...')
    const folderMeta = await getFileMetadata(accessToken, folderId)
    
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
    
    console.log(`Indexed ${fileRecords.length} files, saving to database...`)
    
    if (fileRecords.length > 0) {
      const { error: upsertError } = await supabase
        .from('file_metadata')
        .upsert(fileRecords, { onConflict: 'source_id,file_id' })
      
      if (upsertError) {
        console.error('Error saving files to database:', upsertError)
        return NextResponse.json({ 
          error: 'Failed to save indexed files', 
          details: upsertError.message 
        }, { status: 500 })
      }
    }
    
    // Generate summaries if requested
    let summaryCount = 0
    if (generateSummaries) {
      console.log('Generating summaries...')
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
          console.log(`Generated ${summaryCount} summaries`)
        } else {
          console.error('Summary generation failed:', await summaryResponse.text())
        }
      } catch (error) {
        console.error('Error generating summaries:', error)
      }
    }
    
    const resynced = existingFiles && existingFiles.length > 0
    
    console.log('=== INDEX COMPLETE ===')
    console.log(`Success! Indexed ${fileRecords.length} files, generated ${summaryCount} summaries`)
    
    return NextResponse.json({ 
      success: true,
      resynced,
      indexed: fileRecords.length,
      summariesGenerated: summaryCount
    })
    
  } catch (error: any) {
    console.error('=== INDEX ERROR ===')
    console.error('Indexing error:', error)
    console.error('Stack:', error.stack)
    return NextResponse.json(
      { error: 'Failed to index folder', details: error.message }, 
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    
    // Get session
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    const { folderId, clearAll } = await request.json()
    
    // Get Drive source
    const { data: source } = await supabase
      .from('data_sources')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('type', 'drive')
      .single()
    
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