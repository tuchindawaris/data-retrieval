import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'
import { generateSummaries } from '@/lib/summary-generator'
import { extractDocumentText } from '@/lib/document-processor'
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

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  console.log('\n========== GENERATE SUMMARIES REQUEST ==========')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  
  try {
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
    const cookieStore = cookies()
    const tokensCookie = cookieStore.get('google_tokens')
    if (!tokensCookie) {
      console.error('✗ No Google auth tokens found')
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    const tokens = JSON.parse(tokensCookie.value)
    let accessToken = tokens.access_token
    
    // Check if token is expired and refresh if needed
    if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
      console.log('⚠️  Access token expired, attempting to refresh...')
      
      if (tokens.refresh_token) {
        const oauth2Client = getOAuth2Client()
        oauth2Client.setCredentials(tokens)
        
        try {
          const { credentials } = await oauth2Client.refreshAccessToken()
          accessToken = credentials.access_token!
          
          // Update stored tokens
          const cookieStore = cookies()
          cookieStore.set('google_tokens', JSON.stringify(credentials), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
          })
          
          console.log('✓ Successfully refreshed access token')
        } catch (error) {
          console.error('✗ Failed to refresh token:', error)
          return NextResponse.json({ error: 'Authentication expired. Please reconnect Google Drive.' }, { status: 401 })
        }
      } else {
        console.error('✗ No refresh token available')
        return NextResponse.json({ error: 'Authentication expired. Please reconnect Google Drive.' }, { status: 401 })
      }
    }
    
    // Get files that need summaries
    console.log('\n--- Fetching files from database ---')
    let query = supabaseAdmin
      .from('file_metadata')
      .select('*')
      .is('metadata->>summary', null) // Only files without summaries
    
    if (folderId) {
      // If folderId provided, only process files in that folder
      query = query.or(`file_id.eq.${folderId},metadata->>parentFolderId.eq.${folderId}`)
    }
    
    const { data: files, error } = await query
    
    if (error) {
      console.error('✗ Database error:', error)
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    }
    
    console.log(`Found ${files?.length || 0} files without summaries`)
    
    if (!files || files.length === 0) {
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
    
    // Update metadata with summaries
    console.log('\n--- Updating database with summaries ---')
    let updatedCount = 0
    let updateErrors = []
    
    for (const summary of allSummaries) {
      const file = files.find(f => f.file_id === summary.fileId)
      if (!file) {
        console.error(`✗ Could not find file for summary: ${summary.fileId}`)
        continue
      }
      
      const updatedMetadata = { ...file.metadata }
      updatedMetadata.summary = summary.summary
      updatedMetadata.summaryGeneratedAt = new Date().toISOString()
      updatedMetadata.summaryStatus = 'success'
      updatedMetadata.summaryError = null
      
      // Add sheet summaries if applicable
      if (summary.sheetSummaries && updatedMetadata.sheets) {
        updatedMetadata.sheets = updatedMetadata.sheets.map((sheet: any) => ({
          ...sheet,
          summary: summary.sheetSummaries![sheet.name] || null,
          summaryStatus: summary.sheetSummaries![sheet.name] ? 'success' : 'missing'
        }))
        
        // Log any missing sheet summaries
        const missingSheetsCount = updatedMetadata.sheets.filter((s: any) => !s.summary).length
        if (missingSheetsCount > 0) {
          console.log(`  ⚠️  ${file.name}: ${missingSheetsCount} sheets missing summaries`)
        }
      }
      
      const { error: updateError } = await supabaseAdmin
        .from('file_metadata')
        .update({ metadata: updatedMetadata })
        .eq('id', file.id)
      
      if (!updateError) {
        updatedCount++
        console.log(`  ✓ Updated: ${file.name}`)
      } else {
        updateErrors.push({ fileName: file.name, error: updateError })
        console.error(`  ✗ Failed to update ${file.name}:`, updateError)
      }
    }
    
    // Mark failed files in metadata
    for (const failure of allFailures) {
      const file = files.find(f => f.file_id === failure.fileId)
      if (!file) continue
      
      const updatedMetadata = { ...file.metadata }
      updatedMetadata.summaryStatus = 'failed'
      updatedMetadata.summaryError = failure.reason
      updatedMetadata.summaryAttemptedAt = new Date().toISOString()
      
      await supabaseAdmin
        .from('file_metadata')
        .update({ metadata: updatedMetadata })
        .eq('id', file.id)
    }
    
    // Final summary
    const duration = Date.now() - startTime
    console.log('\n========== SUMMARY GENERATION COMPLETE ==========')
    console.log(`Duration: ${duration}ms`)
    console.log(`Files processed: ${filesToSummarize.length}`)
    console.log(`Summaries generated: ${allSummaries.length}`)
    console.log(`Database updates: ${updatedCount}`)
    console.log(`Failed summaries: ${allFailures.length}`)
    console.log(`Update errors: ${updateErrors.length}`)
    console.log(`Skipped files: ${skippedFiles.length}`)
    console.log(`Total tokens used: ${totalTokensUsed}`)
    
    return NextResponse.json({ 
      success: true,
      processed: filesToSummarize.length,
      updated: updatedCount,
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