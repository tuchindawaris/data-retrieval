// app/api/search/spreadsheet/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getOAuth2Client } from '@/lib/google-drive'
import { SpreadsheetSearchAnalyzer } from '@/lib/spreadsheet-search-analyzer'
import { ColumnMatcher } from '@/lib/column-matcher'
import { SpreadsheetDataRetriever } from '@/lib/spreadsheet-data-retriever'
import { 
  SpreadsheetSearchRequest, 
  SpreadsheetSearchResult,
  SheetMatch
} from '@/lib/spreadsheet-search-types'

// Initialize services
const analyzer = new SpreadsheetSearchAnalyzer()
const columnMatcher = new ColumnMatcher()
const dataRetriever = new SpreadsheetDataRetriever()

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
  console.log('\n========== SPREADSHEET SEARCH REQUEST ==========')
  
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
    
    // Parse request
    const body: SpreadsheetSearchRequest = await request.json()
    const { 
      query, 
      matchThreshold = 0.7,
      maxSheets = 10,
      includeEmptyRows = false
    } = body
    
    console.log(`Query: "${query}"`)
    console.log(`Settings: threshold=${matchThreshold}, maxSheets=${maxSheets}`)
    
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query cannot be empty' }, { status: 400 })
    }
    
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
      return NextResponse.json({ 
        error: 'No Drive source found. Please connect Google Drive first.' 
      }, { status: 404 })
    }
    
    // Step 1: Analyze query intent
    console.log('\n--- Step 1: Analyzing query intent ---')
    const intent = await analyzer.analyzeQueryIntent(query)
    console.log('Intent:', intent)
    
    // Step 2: Get all spreadsheet files
    console.log('\n--- Step 2: Loading spreadsheet metadata ---')
    const { data: files, error: filesError } = await supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', source.id)
      .eq('metadata->isSpreadsheet', true)
    
    if (filesError) {
      console.error('Database error:', filesError)
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    }
    
    if (!files || files.length === 0) {
      console.log('No spreadsheet files found')
      return NextResponse.json({ 
        results: [],
        query,
        duration: Date.now() - startTime
      })
    }
    
    console.log(`Found ${files.length} spreadsheet files`)
    
    // Step 3: Match sheets to query
    console.log('\n--- Step 3: Matching sheets to query ---')
    const matchedSheets = await analyzer.matchSheetsToQuery(query, files, intent)
    const relevantSheets = matchedSheets
      .filter(m => m.relevanceScore >= matchThreshold)
      .slice(0, maxSheets)
    
    console.log(`Matched ${relevantSheets.length} sheets above threshold`)
    
    if (relevantSheets.length === 0) {
      console.log('No sheets matched the query')
      return NextResponse.json({ 
        results: [],
        query,
        duration: Date.now() - startTime
      })
    }
    
    // Step 4: Process each matched sheet
    console.log('\n--- Step 4: Processing matched sheets ---')
    const results: SpreadsheetSearchResult[] = []
    
    for (const sheetMatch of relevantSheets) {
      try {
        console.log(`\nProcessing: ${sheetMatch.fileName} - ${sheetMatch.sheetName}`)
        
        // Get file metadata
        const file = files.find(f => f.file_id === sheetMatch.fileId)
        if (!file) continue
        
        const sheetMeta = file.metadata?.sheets?.[sheetMatch.sheetIndex]
        if (!sheetMeta) {
          console.log('Sheet metadata not found, skipping')
          continue
        }
        
        // Step 4a: Match columns
        const availableColumns = sheetMeta.columns
          ?.filter((c: any) => c)
          ?.map((c: any, i: number) => ({
            name: c.name || `Column ${i + 1}`,
            index: i,
            dataType: c.dataType
          })) || []
        
        const matchedColumns = await columnMatcher.matchColumns(
          intent.targetColumns,
          availableColumns
        )
        
        console.log(`Matched ${matchedColumns.length} columns:`, 
          matchedColumns.map(c => `${c.column} (${c.confidence.toFixed(2)})`).join(', ')
        )
        
        // Step 4b: Retrieve data
        const searchStartTime = Date.now()
        const sheetData = await dataRetriever.retrieveSheetData(
          accessToken,
          file.file_id,
          file.name,
          file.mime_type,
          sheetMatch.sheetName,
          sheetMatch.sheetIndex,
          {
            keyColumns: matchedColumns,
            filters: intent.filters,
            includeEmptyRows,
            maxRows: 1000
          }
        )
        
        const searchDuration = Date.now() - searchStartTime
        
        // Build result
        const result: SpreadsheetSearchResult = {
          fileId: file.file_id,
          fileName: file.name,
          sheetName: sheetMatch.sheetName,
          sheetIndex: sheetMatch.sheetIndex,
          relevanceScore: sheetMatch.relevanceScore,
          matchedColumns: matchedColumns.map(mc => ({
            columnName: mc.column,
            columnLetter: getColumnLetter(mc.index),
            columnIndex: mc.index,
            matchConfidence: mc.confidence,
            matchReason: mc.method
          })),
          data: {
            headers: sheetData.headers,
            rows: sheetData.rows,
            totalRowsFound: sheetData.totalRows,
            truncated: sheetData.truncated
          },
          metadata: {
            totalRows: sheetMeta.totalRows || 0,
            searchDuration,
            cacheHit: sheetData.cacheHit
          }
        }
        
        results.push(result)
        console.log(`✓ Found ${sheetData.rows.length} rows (${sheetData.cacheHit ? 'cached' : 'fresh'})`)
        
      } catch (error: any) {
        console.error(`✗ Error processing ${sheetMatch.fileName}:`, error.message)
      }
    }
    
    // Final summary
    const duration = Date.now() - startTime
    console.log('\n========== SEARCH COMPLETE ==========')
    console.log(`Total duration: ${duration}ms`)
    console.log(`Results: ${results.length} sheets`)
    console.log(`Total rows: ${results.reduce((sum, r) => sum + r.data.rows.length, 0)}`)
    
    return NextResponse.json({ 
      results,
      query,
      intent,
      duration
    })
    
  } catch (error: any) {
    console.error('\n✗ CRITICAL ERROR:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error.message }, 
      { status: 500 }
    )
  }
}

// Convert column index to letter (0 -> A, 1 -> B, etc.)
function getColumnLetter(index: number): string {
  let letter = ''
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter
    index = Math.floor(index / 26) - 1
  }
  return letter
}

// Get cache statistics endpoint
export async function GET() {
  const stats = dataRetriever.getCacheStats()
  return NextResponse.json(stats)
}