import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { generateQueryEmbedding } from '@/lib/embedding-generator'

export interface SearchResult {
  fileId: string
  fileName: string
  chunkText: string
  chunkIndex: number
  similarity: number
  metadata: {
    start_char: number
    end_char: number
    section_context?: string
    preceding_context: string
    following_context: string
  }
  citation: {
    driveWebLink: string
    documentTitle: string
    lastModified?: string
    location: string
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    const { 
      query, 
      matchCount = 10, 
      matchThreshold = 0.2 
    } = await request.json()
    
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query cannot be empty' }, { status: 400 })
    }
    
    console.log(`\n--- Semantic Search ---`)
    console.log(`Query: "${query}"`)
    console.log(`Match count: ${matchCount}, threshold: ${matchThreshold}`)
    
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
    
    // Generate embedding for the query
    console.log('Generating query embedding...')
    const queryEmbedding = await generateQueryEmbedding(query)
    
    // Search for similar chunks using the Supabase function
    console.log('Searching for similar chunks...')
    const { data: matches, error: searchError } = await supabase
      .rpc('search_documents', {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        user_source_id: source.id
      })
    
    if (searchError) {
      console.error('Search error:', searchError)
      return NextResponse.json({ 
        error: 'Search failed', 
        details: searchError.message 
      }, { status: 500 })
    }
    
    if (!matches || matches.length === 0) {
      console.log('No matches found')
      return NextResponse.json({ 
        results: [],
        query,
        duration: Date.now() - startTime
      })
    }
    
    console.log(`Found ${matches.length} matches`)
    
    // Get file metadata and citations for the matches
    const fileIds = [...new Set(matches.map((m: any) => m.file_id))]
    
    const { data: files } = await supabase
      .from('file_metadata')
      .select('file_id, name')
      .in('file_id', fileIds)
    
    const { data: citations } = await supabase
      .from('document_citations')
      .select('*')
      .in('file_id', fileIds)
    
    // Create file lookup maps
    const fileMap = new Map(files?.map(f => [f.file_id, f]) || [])
    const citationMap = new Map(citations?.map(c => [c.file_id, c]) || [])
    
    // Format results
    const results: SearchResult[] = matches.map((match: any) => {
      const file = fileMap.get(match.file_id)
      const citation = citationMap.get(match.file_id)
      const metadata = match.metadata || {}
      
      // Build location string
      let location = `Chunk ${match.chunk_index + 1}`
      if (metadata.section_context) {
        location = `${metadata.section_context} - ${location}`
      }
      
      return {
        fileId: match.file_id,
        fileName: file?.name || 'Unknown',
        chunkText: match.chunk_text,
        chunkIndex: match.chunk_index,
        similarity: match.similarity,
        metadata: {
          start_char: metadata.start_char || 0,
          end_char: metadata.end_char || match.chunk_text.length,
          section_context: metadata.section_context,
          preceding_context: metadata.preceding_context || '',
          following_context: metadata.following_context || ''
        },
        citation: {
          driveWebLink: citation?.drive_web_link || `https://drive.google.com/file/d/${match.file_id}/view`,
          documentTitle: citation?.document_title || file?.name || 'Unknown',
          lastModified: citation?.last_modified,
          location
        }
      }
    })
    
    const duration = Date.now() - startTime
    console.log(`Search completed in ${duration}ms`)
    
    return NextResponse.json({ 
      results,
      query,
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