import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { generateSummaries } from '@/lib/summary-generator'
import { extractDocumentText } from '@/lib/document-processor'
import { getUserGoogleTokens, getUserDriveSource } from '@/lib/google-tokens'

const DOCUMENT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.google-apps.document',
  'application/rtf',
  'application/vnd.oasis.opendocument.text'
]

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  console.log('\n========== GENERATE SUMMARIES REQUEST ==========')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('✗ OpenAI API key not configured')
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your .env.local file.' },
        { status: 500 }
      )
    }
    
    const { folderId } = await request.json()
    console.log(`Folder ID: ${folderId || 'ALL FILES'}`)
    
    // Get tokens
    const tokens = await getUserGoogleTokens()
    if (!tokens) {
      console.error('✗ No Google auth tokens found')
      return NextResponse.json({ error: 'Not authenticated with Google Drive' }, { status: 401 })
    }
    
    const accessToken = tokens.access_token
    
    // Get user's Drive source
    const source = await getUserDriveSource(session.user.id)
    if (!source) {
      return NextResponse.json({ error: 'No Drive source found' }, { status: 404 })
    }
    
    // Get files that need summaries - check both metadata and file_summaries
    console.log('\n--- Fetching files from database ---')
    
    // First get all files for this source
    let query = supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', source.id)
    
    if (folderId) {
      // If folderId provided, only process files in that folder
      query = query.or(`file_id.eq.${folderId},metadata->>parentFolderId.eq.${folderId}`)
    }
    
    const { data: allFiles, error: filesError } = await query
    
    if (filesError) {
      console.error('✗ Database error:', filesError)
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    }
    
    // Get existing summaries
    const { data: existingSummaries } = await supabase
      .from('file_summaries')
      .select('file_id')
      .eq('source_id', source.id)
    
    const summaryFileIds = new Set(existingSummaries?.map(s => s.file_id) || [])
    
    // Filter files that don't have summaries
    const files = allFiles?.filter(file => !summaryFileIds.has(file.file_id)) || []
    
    console.log(`Found ${files.length} files without summaries`)
    
    if (files.length === 0) {
      console.log('✓ No files need summaries')
      return NextResponse.json({ 
        message: 'No files need summaries',
        processed: 0,
        updated: 0,
        failed: 0
      })
    }
    
    // Prepare files for summary generation
    console.log('\n--- Preparing files for summary generation ---')
    const filesToSummarize = []
    const skippedFiles = []
    
    for (const file of files) {
      // Skip folders
      if (file.metadata?.isFolder) {
        skippedFiles.push({ name: file.name, reason: 'folder' })
        continue
      }
      
      // Skip files with errors
      if (file.metadata?.spreadsheetError) {
        skippedFiles.push({ name: file.name, reason: 'previous spreadsheet error' })
        continue
      }
      
      let content = null
      
      // For spreadsheets, use metadata
      if (file.metadata?.isSpreadsheet && file.metadata?.sheets) {
        content = {
          sheets: file.metadata.sheets
        }
        console.log(`  ✓ Prepared spreadsheet: ${file.name} (${file.metadata.sheets.length} sheets)`)
      }
      // For documents, extract text
      else if (DOCUMENT_MIME_TYPES.includes(file.mime_type) || 
               file.name.endsWith('.txt') || 
               file.name.endsWith('.md') ||
               file.name.endsWith('.docx')) {
        try {
          console.log(`  ⏳ Extracting text from: ${file.name}`)
          const text = await extractDocumentText(
            accessToken,
            file.file_id,
            file.name,
            file.mime_type
          )
          // Only add if we got meaningful text
          if (text && !text.startsWith('[Unable to extract')) {
            content = text
            console.log(`  ✓ Extracted ${text.length} chars from: ${file.name}`)
          } else {
            skippedFiles.push({ name: file.name, reason: 'unable to extract text' })
            console.log(`  ✗ Unable to extract text from: ${file.name}`)
          }
        } catch (error: any) {
          skippedFiles.push({ name: file.name, reason: `extraction error: ${error.message}` })
          console.error(`  ✗ Error extracting text from ${file.name}:`, error.message)
        }
      } else {
        skippedFiles.push({ name: file.name, reason: 'unsupported file type' })
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
    
    console.log(`\nFile preparation complete:`)
    console.log(`  - Ready for summarization: ${filesToSummarize.length}`)
    console.log(`  - Skipped: ${skippedFiles.length}`)
    if (skippedFiles.length > 0) {
      console.log(`\nSkipped files:`)
      skippedFiles.forEach(f => console.log(`  - ${f.name}: ${f.reason}`))
    }
    
    if (filesToSummarize.length === 0) {
      console.log('\n✓ No processable files found')
      return NextResponse.json({ 
        message: 'No processable files found',
        processed: 0,
        updated: 0,
        failed: 0,
        skipped: skippedFiles.length
      })
    }
    
    // Generate summaries in batches
    console.log(`\n--- Starting summary generation ---`)
    console.log(`Total files to process: ${filesToSummarize.length}`)
    
    const batchSize = 10
    const totalBatches = Math.ceil(filesToSummarize.length / batchSize)
    const allResults = []
    let totalTokensUsed = 0
    
    for (let i = 0; i < filesToSummarize.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1
      const batch = filesToSummarize.slice(i, i + batchSize)
      console.log(`\n--- Processing batch ${batchNum}/${totalBatches} (${batch.length} files) ---`)
      
      try {
        const result = await generateSummaries(batch)
        allResults.push(result)
        totalTokensUsed += result.promptTokens
        
        console.log(`Batch ${batchNum} complete: ${result.stats.successful}/${result.stats.submitted} successful`)
      } catch (error: any) {
        console.error(`✗ Critical error in batch ${batchNum}:`, error.message || error)
      }
    }
    
    // Aggregate all summaries
    const allSummaries = allResults.flatMap(r => r.summaries)
    const allFailures = allResults.flatMap(r => r.failures)
    
    console.log(`\n--- Summary generation complete ---`)
    console.log(`Total summaries generated: ${allSummaries.length}`)
    console.log(`Total failures: ${allFailures.length}`)
    console.log(`Total tokens used: ${totalTokensUsed}`)
    
    // Save summaries to database
    console.log('\n--- Saving summaries to database ---')
    let savedCount = 0
    let saveErrors = []
    
    for (const summary of allSummaries) {
      const { error } = await supabase
        .from('file_summaries')
        .insert({
          source_id: source.id,
          file_id: summary.fileId,
          summary: summary.summary,
          sheet_summaries: summary.sheetSummaries || null,
          summary_tokens: Math.ceil(summary.summary.length / 4), // Rough estimate
          generated_at: new Date().toISOString()
        })
      
      if (!error) {
        savedCount++
        console.log(`  ✓ Saved summary for: ${summary.fileId}`)
      } else {
        saveErrors.push({ fileId: summary.fileId, error })
        console.error(`  ✗ Failed to save summary for ${summary.fileId}:`, error)
      }
    }
    
    // Final summary
    const duration = Date.now() - startTime
    console.log('\n========== SUMMARY GENERATION COMPLETE ==========')
    console.log(`Duration: ${duration}ms`)
    console.log(`Files processed: ${filesToSummarize.length}`)
    console.log(`Summaries generated: ${allSummaries.length}`)
    console.log(`Summaries saved: ${savedCount}`)
    console.log(`Failed summaries: ${allFailures.length}`)
    console.log(`Save errors: ${saveErrors.length}`)
    console.log(`Skipped files: ${skippedFiles.length}`)
    console.log(`Total tokens used: ${totalTokensUsed}`)
    
    return NextResponse.json({ 
      success: true,
      processed: filesToSummarize.length,
      updated: savedCount,
      failed: allFailures.length,
      skipped: skippedFiles.length,
      tokensUsed: totalTokensUsed,
      duration: duration
    })
    
  } catch (error: any) {
    console.error('\n✗ CRITICAL ERROR:', error)
    return NextResponse.json(
      { error: 'Failed to generate summaries', details: error.message }, 
      { status: 500 }
    )
  }
}