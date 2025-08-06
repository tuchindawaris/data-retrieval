// app/api/search/spreadsheet-enhanced/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getOAuth2Client } from '@/lib/google-drive'
import { EnhancedSpreadsheetSearch } from '@/lib/spreadsheet-search-enhanced'
import { SpreadsheetSearchRequest } from '@/lib/spreadsheet-search-types'

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
  console.log('\n========== ENHANCED SPREADSHEET SEARCH REQUEST ==========')
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
    
    // Get all spreadsheet files
    console.log('\n--- Loading spreadsheet metadata ---')
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
    
    // Perform enhanced search
    const enhancedSearch = new EnhancedSpreadsheetSearch()
    const searchResult = await enhancedSearch.search(
      {
        query,
        matchThreshold,
        maxSheets,
        includeEmptyRows
      },
      files,
      accessToken
    )
    
    // Transform results for API response
    const transformedResults = searchResult.results.map(result => ({
      fileId: result.fileId,
      fileName: result.fileName,
      sheetName: result.sheetName,
      sheetIndex: result.sheetIndex,
      relevanceScore: result.relevanceScore,
      data: result.extraction.result,
      extractionInfo: {
        description: result.extraction.plan.description,
        expectedFormat: result.extraction.plan.expectedOutputFormat,
        confidence: result.extraction.plan.confidence,
        warnings: result.extraction.plan.warnings,
        executionTime: result.extraction.executionTime,
        rowsProcessed: result.extraction.rowsProcessed
      },
      sheetInfo: {
        totalRows: result.metadata.totalRows,
        totalColumns: result.extraction.structure.dimensions.cols,
        dataStartsAt: result.extraction.structure.tables[0]?.bounds.startRow || 0,
        hasFormulas: result.extraction.structure.metadata.hasFormulas,
        hasMergedCells: result.extraction.structure.metadata.hasMergedCells
      }
    }))
    
    const duration = Date.now() - startTime
    console.log('\n========== SEARCH COMPLETE ==========')
    console.log(`Total duration: ${duration}ms`)
    console.log(`Results: ${transformedResults.length}`)
    
    return NextResponse.json({ 
      results: transformedResults,
      query,
      intent: searchResult.intent,
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