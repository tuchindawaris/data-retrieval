import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getOAuth2Client } from '@/lib/google-drive'
import { EnhancedSpreadsheetSearch } from '@/lib/spreadsheet-search-enhanced'
import { SpreadsheetSearchRequest } from '@/lib/spreadsheet-search-types'

async function refreshTokenIfNeeded(tokens: any, cookieStore: any) {
  if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials(tokens)
    
    try {
      const { credentials } = await oauth2Client.refreshAccessToken()
      
      cookieStore.set('google_tokens', JSON.stringify(credentials), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
      })
      
      return credentials.access_token
    } catch (error) {
      throw new Error('Failed to refresh Google token')
    }
  }
  
  return tokens.access_token
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      )
    }
    
    const body: SpreadsheetSearchRequest = await request.json()
    const { 
      query, 
      matchThreshold = 0.7,
      maxSheets = 10,
      includeEmptyRows = false
    } = body
    
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query cannot be empty' }, { status: 400 })
    }
    
    // Get tokens
    const cookieStore = cookies()
    const tokensCookie = cookieStore.get('google_tokens')
    if (!tokensCookie) {
      return NextResponse.json({ error: 'Not authenticated with Google Drive' }, { status: 401 })
    }
    
    const tokens = JSON.parse(tokensCookie.value)
    const accessToken = await refreshTokenIfNeeded(tokens, cookieStore)
    
    // Get Drive source
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
    
    // Get spreadsheet files
    const { data: files, error: filesError } = await supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', source.id)
      .eq('metadata->isSpreadsheet', true)
    
    if (filesError) {
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    }
    
    if (!files || files.length === 0) {
      return NextResponse.json({ 
        results: [],
        query,
        duration: Date.now() - startTime
      })
    }
    
    // Perform enhanced search
    const enhancedSearch = new EnhancedSpreadsheetSearch()
    const searchResult = await enhancedSearch.search(
      { query, matchThreshold, maxSheets, includeEmptyRows },
      files,
      accessToken
    )
    
    // Transform results for API response
    const transformedResults = searchResult.results.map(result => {
      // Convert extraction result to rows format
      let headers: string[] = []
      let rows: any[][] = []
      
      if (Array.isArray(result.extraction.result)) {
        // If result is array of objects
        if (result.extraction.result.length > 0 && typeof result.extraction.result[0] === 'object') {
          headers = Object.keys(result.extraction.result[0])
          rows = result.extraction.result.map((obj: any) => 
            headers.map(h => obj[h])
          )
        } else {
          // If result is array of arrays
          rows = result.extraction.result
        }
      } else if (typeof result.extraction.result === 'object' && result.extraction.result !== null) {
        // If result is object (e.g., grouped data)
        const entries = Object.entries(result.extraction.result)
        
        if (entries.length > 0) {
          // Check if values are objects or primitives
          const firstValue = entries[0][1]
          
          if (typeof firstValue === 'object' && firstValue !== null) {
            // Values are objects, extract their properties
            const valueKeys = Object.keys(firstValue)
            headers = ['Key', ...valueKeys]
            rows = entries.map(([key, value]: [string, any]) => {
              return [key, ...valueKeys.map(k => value[k] || '')]
            })
          } else {
            // Values are primitives
            headers = ['Key', 'Value']
            rows = entries.map(([k, v]) => [k, v])
          }
        }
      }
      
      // Ensure rows is always an array of arrays
      if (!Array.isArray(rows)) {
        rows = []
      }
      
      return {
        fileId: result.fileId,
        fileName: result.fileName,
        sheetName: result.sheetName,
        sheetIndex: result.sheetIndex,
        relevanceScore: result.relevanceScore,
        data: {
          headers,
          rows,
          totalRowsFound: rows.length,
          truncated: false
        },
        extractionInfo: {
          description: result.extraction.plan.description,
          confidence: result.extraction.plan.confidence,
          warnings: result.extraction.plan.warnings,
          executionTime: result.extraction.executionTime,
          rowsProcessed: result.extraction.rowsProcessed
        },
        sheetInfo: {
          totalRows: result.metadata.totalRows,
          totalColumns: result.extraction.structure.dimensions.cols,
          dataStartsAt: result.extraction.structure.metadata.dataStartRow
        }
      }
    })
    
    const duration = Date.now() - startTime
    
    return NextResponse.json({ 
      results: transformedResults,
      query,
      intent: searchResult.intent,
      duration
    })
    
  } catch (error: any) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error.message }, 
      { status: 500 }
    )
  }
}