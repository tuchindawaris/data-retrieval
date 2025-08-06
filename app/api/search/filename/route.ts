// app/api/search/filename/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import OpenAI from 'openai'

export interface FilenameSearchResult {
  fileId: string
  fileName: string
  mimeType: string
  size: number
  folderPath: string
  relevanceScore: number
  matchReason: string
  modifiedTime?: string
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to your .env.local file.' },
        { status: 500 }
      )
    }
    
    const { 
      query, 
      matchThreshold = 0.5,
      maxResults = 20 
    } = await request.json()
    
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query cannot be empty' }, { status: 400 })
    }
    
    console.log(`\n--- File Name Search ---`)
    console.log(`Query: "${query}"`)
    console.log(`Threshold: ${matchThreshold}, Max results: ${maxResults}`)
    
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
    
    // Get all files (excluding folders)
    const { data: files, error: filesError } = await supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', source.id)
      .neq('metadata->isFolder', true)
    
    if (filesError) {
      console.error('Database error:', filesError)
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 })
    }
    
    if (!files || files.length === 0) {
      return NextResponse.json({ 
        results: [],
        query,
        duration: Date.now() - startTime
      })
    }
    
    // Filter to only unsupported files (not spreadsheets or documents)
    const unsupportedFiles = files.filter(file => 
      !file.metadata?.isSpreadsheet && 
      !file.metadata?.isDocument
    )
    
    console.log(`Found ${unsupportedFiles.length} unsupported files out of ${files.length} total files`)
    
    if (unsupportedFiles.length === 0) {
      return NextResponse.json({ 
        results: [],
        query,
        duration: Date.now() - startTime
      })
    }
    
    // Use OpenAI to match files
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
    
    // Build file list for OpenAI
    const fileList = unsupportedFiles.map(f => ({
      fileId: f.file_id,
      fileName: f.name,
      mimeType: f.mime_type,
      size: f.size,
      folderPath: f.folder_path,
      modifiedTime: f.metadata?.modifiedTime
    }))
    
    const prompt = `
Given the search query: "${query}"

Analyze these file names and identify which files are most likely to be relevant to the query.
Consider:
1. Direct name matches
2. Semantic similarity (e.g., "presentation" matches "slides", "report" matches "analysis")
3. File extensions that might indicate relevance
4. Folder paths that might indicate context
5. Common abbreviations and variations

Files:
${JSON.stringify(fileList, null, 2)}

For each relevant file, provide:
1. A relevance score (0-1) based on how well the file name matches the query intent
2. A brief reason why it matches

Return JSON format:
{
  "matches": [
    {
      "fileId": "xxx",
      "relevanceScore": 0.85,
      "matchReason": "File name contains 'presentation' which matches the query"
    }
  ]
}

Only include files with relevance score above ${matchThreshold}.
Focus on file names and types that would logically contain what the user is searching for.
`

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that matches file names to search queries. Be accurate and consider semantic meaning, not just literal text matches.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 1500
      })
      
      const response = JSON.parse(completion.choices[0].message.content || '{}')
      const matches = response.matches || []
      
      // Build results
      const results: FilenameSearchResult[] = matches
        .filter((m: any) => m.relevanceScore >= matchThreshold)
        .map((match: any) => {
          const file = unsupportedFiles.find(f => f.file_id === match.fileId)
          if (!file) return null
          
          return {
            fileId: file.file_id,
            fileName: file.name,
            mimeType: file.mime_type,
            size: file.size,
            folderPath: file.folder_path,
            relevanceScore: Math.min(1, Math.max(0, match.relevanceScore)),
            matchReason: match.matchReason || 'Name similarity',
            modifiedTime: file.metadata?.modifiedTime
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxResults)
      
      const duration = Date.now() - startTime
      console.log(`Search completed in ${duration}ms, found ${results.length} matches`)
      
      return NextResponse.json({ 
        results,
        query,
        duration
      })
      
    } catch (error: any) {
      console.error('OpenAI error:', error)
      return NextResponse.json(
        { error: 'Search failed', details: error.message }, 
        { status: 500 }
      )
    }
    
  } catch (error: any) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error.message }, 
      { status: 500 }
    )
  }
}