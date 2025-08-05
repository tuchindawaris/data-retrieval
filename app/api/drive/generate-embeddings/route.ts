import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { processDocumentForEmbedding } from '@/lib/document-processor-enhanced'
import { generateEmbeddings } from '@/lib/embedding-generator'
import { getOAuth2Client } from '@/lib/google-drive'

const DOCUMENT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.google-apps.document',
  'application/rtf',
  'application/vnd.oasis.opendocument.text'
]

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
  const startTime = Date.now()
  console.log('\n========== GENERATE EMBEDDINGS REQUEST ==========')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('✗ OpenAI API key not configured')
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your .env.local file.' },
        { status: 500 }
      )
    }
    
    const { folderId, forceRegenerate = false } = await request.json()
    console.log(`Folder ID: ${folderId || 'ALL FILES'}`)
    console.log(`Force regenerate: ${forceRegenerate}`)
    
    // Get tokens from cookies
    const cookieStore = cookies()
    const tokensCookie = cookieStore.get('google_tokens')
    if (!tokensCookie) {
      console.error('✗ No Google auth tokens found')
      return NextResponse.json({ error: 'Not authenticated with Google Drive' }, { status: 401 })
    }
    
    const tokens = JSON.parse(tokensCookie.value)
    const accessToken = await refreshTokenIfNeeded(tokens, cookieStore)
    
    // Get user's Drive source
    const { data: source } = await supabase
      .from('data_sources')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('type', 'drive')
      .single()
    
    if (!source) {
      return NextResponse.json({ error: 'No Drive source found' }, { status: 404 })
    }
    
    // Get documents that need embeddings
    console.log('\n--- Fetching documents ---')
    
    // Get all documents
    let query = supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', source.id)
      .or(`mime_type.in.(${DOCUMENT_MIME_TYPES.join(',')}),name.like.%.txt,name.like.%.md,name.like.%.docx`)
    
    if (folderId) {
      query = query.or(`file_id.eq.${folderId},metadata->>parentFolderId.eq.${folderId}`)
    }
    
    const { data: documents, error: filesError } = await query
    
    if (filesError) {
      console.error('✗ Database error:', filesError)
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    }
    
    console.log(`Found ${documents?.length || 0} documents`)
    
    if (!documents || documents.length === 0) {
      return NextResponse.json({ 
        message: 'No documents found',
        processed: 0,
        embedded: 0,
        failed: 0
      })
    }
    
    // Check which documents already have embeddings
    let documentsToProcess = documents
    
    if (!forceRegenerate) {
      const { data: existingEmbeddings } = await supabase
        .from('document_embeddings')
        .select('file_id')
        .eq('source_id', source.id)
      
      const embeddedFileIds = new Set(existingEmbeddings?.map(e => e.file_id) || [])
      documentsToProcess = documents.filter(doc => !embeddedFileIds.has(doc.file_id))
      
      console.log(`${documents.length - documentsToProcess.length} documents already have embeddings`)
    }
    
    if (documentsToProcess.length === 0) {
      return NextResponse.json({ 
        message: 'All documents already have embeddings',
        processed: 0,
        embedded: 0,
        failed: 0
      })
    }
    
    // Process documents and generate chunks
    console.log(`\n--- Processing ${documentsToProcess.length} documents ---`)
    const documentsWithChunks = []
    const processingErrors = []
    
    for (const doc of documentsToProcess) {
      try {
        console.log(`Processing: ${doc.name}`)
        
        // Get drive web link
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
              source_id: source.id,
              drive_web_link: driveWebLink,
              document_title: doc.name,
              last_modified: doc.metadata?.modifiedTime,
            })
        }
      } catch (error: any) {
        console.error(`✗ Error processing ${doc.name}:`, error.message)
        processingErrors.push({ fileName: doc.name, error: error.message })
      }
    }
    
    console.log(`Successfully processed ${documentsWithChunks.length} documents`)
    
    if (documentsWithChunks.length === 0) {
      return NextResponse.json({ 
        message: 'No documents could be processed',
        processed: documentsToProcess.length,
        embedded: 0,
        failed: documentsToProcess.length,
        errors: processingErrors
      })
    }
    
    // Generate embeddings
    console.log('\n--- Generating embeddings ---')
    const embeddingResult = await generateEmbeddings(documentsWithChunks)
    
    // Save embeddings to database
    console.log('\n--- Saving embeddings to database ---')
    let savedChunks = 0
    let saveErrors = []
    
    for (const result of embeddingResult.results) {
      // Delete existing embeddings if force regenerate
      if (forceRegenerate) {
        await supabase
          .from('document_embeddings')
          .delete()
          .eq('file_id', result.fileId)
      }
      
      // Prepare batch insert
      const embeddingRecords = result.embeddings.map(emb => ({
        file_id: result.fileId,
        source_id: source.id,
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
        
        if (error) {
          console.error(`✗ Error saving embeddings for ${result.fileId}:`, error)
          saveErrors.push({ fileId: result.fileId, error: error.message })
        } else {
          savedChunks += batch.length
        }
      }
    }
    
    // Final summary
    const duration = Date.now() - startTime
    console.log('\n========== EMBEDDING GENERATION COMPLETE ==========')
    console.log(`Duration: ${duration}ms`)
    console.log(`Documents processed: ${documentsWithChunks.length}`)
    console.log(`Total chunks: ${savedChunks}`)
    console.log(`Embedding errors: ${embeddingResult.errors.length}`)
    console.log(`Save errors: ${saveErrors.length}`)
    console.log(`Total tokens used: ${embeddingResult.totalTokens}`)
    
    return NextResponse.json({ 
      success: true,
      processed: documentsToProcess.length,
      embedded: embeddingResult.results.length,
      failed: processingErrors.length + embeddingResult.errors.length,
      totalChunks: savedChunks,
      tokensUsed: embeddingResult.totalTokens,
      duration: duration
    })
    
  } catch (error: any) {
    console.error('\n✗ CRITICAL ERROR:', error)
    return NextResponse.json(
      { error: 'Failed to generate embeddings', details: error.message }, 
      { status: 500 }
    )
  }
}