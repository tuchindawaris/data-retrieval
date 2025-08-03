import OpenAI from 'openai'

interface FileSummaryRequest {
  fileId: string
  fileName: string
  mimeType: string
  content: string | SpreadsheetMetadata
}

interface SpreadsheetMetadata {
  sheets: Array<{
    name: string
    columns: Array<{
      name: string
      letter: string
      dataType: string
      format?: string
      nonEmptyRows: number
    }>
    totalRows: number
  }>
}

interface SummaryResponse {
  fileId: string
  summary: string
  sheetSummaries?: { [sheetName: string]: string }
}

interface BatchSummaryResult {
  summaries: SummaryResponse[]
  requestId: string
  promptTokens: number
  stats: {
    submitted: number
    successful: number
    failed: number
  }
  failures: Array<{
    fileId: string
    fileName: string
    reason: string
  }>
}

export async function generateSummaries(files: FileSummaryRequest[]): Promise<BatchSummaryResult> {
  const requestId = `batch-${Date.now()}-${Math.random().toString(36).substring(7)}`
  console.log(`\n=== Summary Generation Request ${requestId} ===`)
  console.log(`Processing ${files.length} files:`)
  files.forEach(f => console.log(`  - ${f.fileName} (${f.fileId})`))
  
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured')
  }
  
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  // Build the prompt with file IDs
  let prompt = `Generate concise summaries (1-3 short sentences or phrases) for the following files. For spreadsheets, provide a summary for each sheet AND an overall file summary. Focus on what data/information the file contains and its purpose.

Important: Use the exact file IDs provided in your response.

Files to summarize:
`

  files.forEach((file) => {
    prompt += `\n\n--- File [ID: ${file.fileId}]: ${file.fileName} ---\n`
    
    if (typeof file.content === 'string') {
      // Document
      prompt += `Type: Document\n`
      prompt += `Content:\n${file.content}\n`
    } else {
      // Spreadsheet
      prompt += `Type: Spreadsheet\n`
      if (file.content.sheets && file.content.sheets.length > 0) {
        file.content.sheets.forEach(sheet => {
          prompt += `\nSheet "${sheet.name || 'Unnamed'}":\n`
          prompt += `- ${sheet.totalRows || 0} rows of data\n`
          if (sheet.columns && sheet.columns.length > 0) {
            prompt += `- Columns:\n`
            const validColumns = sheet.columns.filter(col => col)
            validColumns.slice(0, 10).forEach(col => {
              const format = col.format ? ` (${col.format})` : ''
              prompt += `  - ${col.letter || 'Col'}: "${col.name || 'Unnamed'}" - ${col.dataType || 'unknown'}${format}, ${col.nonEmptyRows || 0} non-empty rows\n`
            })
            if (validColumns.length > 10) {
              prompt += `  - ... and ${validColumns.length - 10} more columns\n`
            }
          } else {
            prompt += `- No column information available\n`
          }
        })
      } else {
        prompt += `No sheet information available\n`
      }
    }
  })

  prompt += `\n\nProvide summaries in the following JSON format, using the exact file IDs:
{
  "summaries": {
    "FILE_ID_1": {
      "fileSummary": "Overall summary of the file",
      "sheetSummaries": {
        "Sheet Name 1": "Summary of this sheet",
        "Sheet Name 2": "Summary of this sheet"
      }
    },
    "FILE_ID_2": {
      "fileSummary": "Summary of document"
    }
  }
}

For documents, omit the sheetSummaries field. Keep summaries concise and focused on the data/content.`

  console.log(`\nPrompt length: ${prompt.length} characters (approx ${Math.ceil(prompt.length / 4)} tokens)`)

  try {
    console.log('\nCalling OpenAI API...')
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a data analyst who creates concise summaries of files and spreadsheets. Focus on what information the file contains and its apparent purpose. Always use the exact file IDs provided in the prompt.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 2000
    })

    const usage = completion.usage
    console.log(`\nOpenAI API Response:`)
    console.log(`  - Model: ${completion.model}`)
    console.log(`  - Prompt tokens: ${usage?.prompt_tokens || 0}`)
    console.log(`  - Completion tokens: ${usage?.completion_tokens || 0}`)
    console.log(`  - Total tokens: ${usage?.total_tokens || 0}`)

    const response = JSON.parse(completion.choices[0].message.content || '{}')
    console.log(`\nParsed response structure:`, Object.keys(response))
    
    // Map responses back to files with detailed logging
    const summaries: SummaryResponse[] = []
    const failures: Array<{ fileId: string; fileName: string; reason: string }> = []
    const processedFileIds = new Set<string>()
    
    console.log('\n=== Summary Mapping Process ===')
    
    // Process each file and look for its summary
    for (const file of files) {
      console.log(`\nProcessing ${file.fileName} (${file.fileId})...`)
      
      if (response.summaries && response.summaries[file.fileId]) {
        const summary = response.summaries[file.fileId]
        if (summary.fileSummary) {
          summaries.push({
            fileId: file.fileId,
            summary: summary.fileSummary,
            sheetSummaries: summary.sheetSummaries || undefined
          })
          processedFileIds.add(file.fileId)
          console.log(`  ✓ Found summary: "${summary.fileSummary.substring(0, 50)}..."`)
          if (summary.sheetSummaries) {
            console.log(`  ✓ Found ${Object.keys(summary.sheetSummaries).length} sheet summaries`)
          }
        } else {
          failures.push({
            fileId: file.fileId,
            fileName: file.fileName,
            reason: 'Summary object exists but fileSummary is missing'
          })
          console.log(`  ✗ Summary object exists but fileSummary is missing`)
        }
      } else {
        failures.push({
          fileId: file.fileId,
          fileName: file.fileName,
          reason: 'No summary found in OpenAI response'
        })
        console.log(`  ✗ No summary found in response`)
      }
    }
    
    // Check for any extra summaries in response (shouldn't happen with ID-based system)
    if (response.summaries) {
      const responseFileIds = Object.keys(response.summaries)
      const extraIds = responseFileIds.filter(id => !files.some(f => f.fileId === id))
      if (extraIds.length > 0) {
        console.log(`\n⚠️  Warning: Found summaries for unknown file IDs: ${extraIds.join(', ')}`)
      }
    }
    
    const result: BatchSummaryResult = {
      summaries,
      requestId,
      promptTokens: usage?.prompt_tokens || 0,
      stats: {
        submitted: files.length,
        successful: summaries.length,
        failed: failures.length
      },
      failures
    }
    
    console.log(`\n=== Summary Generation Complete ===`)
    console.log(`Request ID: ${requestId}`)
    console.log(`Stats: ${result.stats.successful}/${result.stats.submitted} successful`)
    if (failures.length > 0) {
      console.log(`\nFailed files:`)
      failures.forEach(f => console.log(`  - ${f.fileName}: ${f.reason}`))
    }
    
    return result

  } catch (error: any) {
    console.error(`\n✗ OpenAI API Error in request ${requestId}:`, error.message || error)
    
    // Return empty result with all files marked as failed
    return {
      summaries: [],
      requestId,
      promptTokens: 0,
      stats: {
        submitted: files.length,
        successful: 0,
        failed: files.length
      },
      failures: files.map(f => ({
        fileId: f.fileId,
        fileName: f.fileName,
        reason: `OpenAI API error: ${error.message || 'Unknown error'}`
      }))
    }
  }
}