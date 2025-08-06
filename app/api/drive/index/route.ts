import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { listFolderContents, getFileMetadata } from '@/lib/google-drive'
import { processSpreadsheet } from '@/lib/spreadsheet-processor'
import { getOAuth2Client } from '@/lib/google-drive'
import { generateSummaries } from '@/lib/summary-generator'
import { processDocumentForEmbedding } from '@/lib/document-processor-enhanced'
import { generateEmbeddings } from '@/lib/embedding-generator'
import { extractDocumentText } from '@/lib/document-processor'

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

// Generate summaries for indexed files
async function generateSummariesForFiles(
  supabase: any,
  sourceId: string,
  fileRecords: any[],
  accessToken: string
) {
  const filesToSummarize = []
  
  for (const file of fileRecords) {
    // Skip folders
    if (file.metadata?.isFolder) continue
    
    // Skip files with errors
    if (file.metadata?.spreadsheetError) continue
    
    let content = null
    
    // For spreadsheets, use metadata
    if (file.metadata?.isSpreadsheet && file.metadata?.sheets) {
      content = {
        sheets: file.metadata.sheets
      }
    }
    // For documents, extract text
    else if (file.metadata?.isDocument) {
      try {
        const text = await extractDocumentText(
          accessToken,
          file.file_id,
          file.name,
          file.mime_type
        )
        if (text && !text.startsWith('[Unable to extract')) {
          content = text
        }
      } catch (error: any) {
        console.error(`Error extracting text from ${file.name}:`, error.message)
      }
    }
    
    if (content) {
      filesToSummarize.push({
        fileId: file.file_id,
        fileName: file.name,
        mimeType: file.mime_type,
        content
      })
    }
  }
  
  if (filesToSummarize.length === 0) {
    return { generated: 0, failed: 0 }
  }
  
  // Generate summaries in batches
  const batchSize = 10
  const allSummaries = []
  const allFailures = []
  
  for (let i = 0; i < filesToSummarize.length; i += batchSize) {
    const batch = filesToSummarize.slice(i, i + batchSize)
    
    try {
      const result = await generateSummaries(batch)
      allSummaries.push(...result.summaries)
      allFailures.push(...result.failures)
    } catch (error: any) {
      console.error(`Error in summary batch:`, error.message)
    }
  }
  
  // Save summaries to database
  let savedCount = 0
  
  for (const summary of allSummaries) {
    const { error } = await supabase
      .from('file_summaries')
      .insert({
        source_id: sourceId,
        file_id: summary.fileId,
        summary: summary.summary,
        sheet_summaries: summary.sheetSummaries || null,
        summary_tokens: Math.ceil(summary.summary.length / 4),
        generated_at: new Date().toISOString()
      })
    
    if (!error) {
      savedCount++
    }
  }
  
  return { generated: savedCount, failed: allFailures.length }
}

// Generate embeddings for documents
async function generateEmbeddingsForDocuments(
  supabase: any,
  sourceId: string,
  fileRecords: any[],
  accessToken: string
) {
  const documentsToProcess = fileRecords.filter(file => 
    file.metadata?.isDocument && !file.metadata?.isFolder
  )
  
  if (documentsToProcess.length === 0) {
    return { embedded: 0, failed: 0 }
  }
  
  const documentsWithChunks = []
  
  for (const doc of documentsToProcess) {
    try {
      const driveWebLink = `https://drive.google.com/file/d/${doc.file_id}/view`
      
      const result = await processDocumentForEmbedding(
        accessToken,
        doc.file_id,
        doc.name,
        doc.mime_type,
        driveWebLink,
        doc.metadata?.modifiedTime
      )
      
      if (result) {
        documentsWithChunks.push({
          fileId: doc.file_id,
          chunks: result.chunks
        })
        
        // Save citation info
        await supabase
          .from('document_citations')
          .upsert({
            file_id: doc.file_id,
            source_id: sourceId,
            drive_web_link: driveWebLink,
            document_title: doc.name,
            last_modified: doc.metadata?.modifiedTime,
          })
      }
    } catch (error: any) {
      console.error(`Error processing ${doc.name}:`, error.message)
    }
  }
  
  if (documentsWithChunks.length === 0) {
    return { embedded: 0, failed: 0 }
  }
  
  // Generate embeddings
  const embeddingResult = await generateEmbeddings(documentsWithChunks)
  
  // Save embeddings to database
  let savedChunks = 0
  
  for (const result of embeddingResult.results) {
    const embeddingRecords = result.embeddings.map(emb => ({
      file_id: result.fileId,
      source_id: sourceId,
      chunk_index: emb.chunk_index,
      chunk_text: emb.chunk_text,
      embedding: emb.embedding,
      metadata: emb.metadata
    }))
    
    // Insert in batches of 100
    for (let i = 0; i < embeddingRecords.length; i += 100) {
      const batch = embeddingRecords.slice(i, i + 100)
      const { error } = await supabase
        .from('document_embeddings')
        .insert(batch)
      
      if (!error) {
        savedChunks += batch.length
      }
    }
  }
  
  return { 
    embedded: embeddingResult.results.length, 
    failed: embeddingResult.errors.length 
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  console.log('\n=== DRIVE INDEX REQUEST ===')
  
  try {
    // Create Supabase client with the request/response
    const supabase = createRouteHandlerClient({ cookies })
    
    // Get the session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session) {
      return NextResponse.json({ 
        error: 'Not authenticated - please log in' 
      }, { status: 401 })
    }
    
    console.log(`Authenticated user: ${session.user.email}`)
    
    const { folderId } = await request.json()
    console.log(`Folder ID: ${folderId}`)
    
    // Get Google tokens from cookies
    const cookieStore = cookies()
    const tokensCookie = cookieStore.get('google_tokens')
    
    if (!tokensCookie) {
      return NextResponse.json({ 
        error: 'Not authenticated with Google Drive - please link Google Drive first' 
      }, { status: 401 })
    }
    
    let tokens
    try {
      tokens = JSON.parse(tokensCookie.value)
    } catch (e) {
      return NextResponse.json({ 
        error: 'Invalid Google tokens - please re-link Google Drive' 
      }, { status: 401 })
    }
    
    // Refresh token if needed
    const accessToken = await refreshTokenIfNeeded(tokens, cookieStore)
    
    // Get or create Drive source for the user
    const { data: source } = await supabase
      .from('data_sources')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('type', 'drive')
      .single()
    
    let sourceId = source?.id
    
    if (!sourceId) {
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
        return NextResponse.json({ 
          error: 'Failed to create Drive source', 
          details: error.message 
        }, { status: 500 })
      }
      
      sourceId = newSource?.id
    }
    
    // Check if folder already indexed
    const { data: existingFiles } = await supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', sourceId)
      .eq('file_id', folderId)
      .eq('metadata->>isFolder', 'true')
      .limit(1)
    
    const resynced = existingFiles && existingFiles.length > 0
    
    if (resynced) {
      // Delete all existing files for this folder
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
    console.log('Starting folder indexing...')
    const fileRecords = await indexFolderRecursive(
      accessToken,
      folderId,
      folderId,
      sourceId
    )
    
    // Get folder metadata for the root folder
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
        return NextResponse.json({ 
          error: 'Failed to save indexed files', 
          details: upsertError.message 
        }, { status: 500 })
      }
    }
    
    // Automatically generate summaries
    console.log('Generating summaries...')
    const summaryResult = await generateSummariesForFiles(
      supabase,
      sourceId,
      fileRecords,
      accessToken
    )
    
    // Automatically generate embeddings for documents
    console.log('Generating embeddings...')
    const embeddingResult = await generateEmbeddingsForDocuments(
      supabase,
      sourceId,
      fileRecords,
      accessToken
    )
    
    const duration = Date.now() - startTime
    console.log('=== INDEX COMPLETE ===')
    console.log(`Duration: ${duration}ms`)
    console.log(`Files indexed: ${fileRecords.length}`)
    console.log(`Summaries generated: ${summaryResult.generated}`)
    console.log(`Embeddings generated: ${embeddingResult.embedded}`)
    
    return NextResponse.json({ 
      success: true,
      resynced,
      indexed: fileRecords.length,
      summariesGenerated: summaryResult.generated,
      embeddingsGenerated: embeddingResult.embedded,
      duration
    })
    
  } catch (error: any) {
    console.error('=== INDEX ERROR ===')
    console.error('Indexing error:', error)
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