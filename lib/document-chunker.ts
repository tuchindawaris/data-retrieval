export interface ChunkWithMetadata {
  text: string
  metadata: {
    start_char: number
    end_char: number
    chunk_index: number
    section_context?: string
    preceding_context: string
    following_context: string
  }
}

interface ChunkingOptions {
  chunkSize?: number // Target chunk size in characters
  overlapSize?: number // Overlap between chunks
  maxChunkSize?: number // Maximum allowed chunk size
}

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
  chunkSize: 1500, // ~375 tokens
  overlapSize: 200, // ~50 tokens overlap
  maxChunkSize: 2000 // ~500 tokens max
}

/**
 * Split document text into overlapping chunks with metadata
 */
export function chunkDocument(
  text: string, 
  options: ChunkingOptions = {}
): ChunkWithMetadata[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const chunks: ChunkWithMetadata[] = []
  
  // Clean and normalize text
  const cleanText = text.trim().replace(/\s+/g, ' ')
  
  if (cleanText.length === 0) {
    return []
  }
  
  // If text is smaller than chunk size, return as single chunk
  if (cleanText.length <= opts.chunkSize) {
    return [{
      text: cleanText,
      metadata: {
        start_char: 0,
        end_char: cleanText.length,
        chunk_index: 0,
        preceding_context: '',
        following_context: ''
      }
    }]
  }
  
  let currentPosition = 0
  let chunkIndex = 0
  
  while (currentPosition < cleanText.length) {
    // Calculate chunk boundaries
    let chunkStart = currentPosition
    let chunkEnd = Math.min(currentPosition + opts.chunkSize, cleanText.length)
    
    // Try to find a sentence boundary near the end
    if (chunkEnd < cleanText.length) {
      const searchStart = Math.max(chunkEnd - 100, chunkStart)
      const lastPeriod = cleanText.lastIndexOf('. ', chunkEnd)
      const lastQuestion = cleanText.lastIndexOf('? ', chunkEnd)
      const lastExclamation = cleanText.lastIndexOf('! ', chunkEnd)
      
      const sentenceBoundary = Math.max(
        lastPeriod > searchStart ? lastPeriod + 2 : -1,
        lastQuestion > searchStart ? lastQuestion + 2 : -1,
        lastExclamation > searchStart ? lastExclamation + 2 : -1
      )
      
      if (sentenceBoundary > searchStart) {
        chunkEnd = sentenceBoundary
      } else {
        // Try to find a word boundary
        const lastSpace = cleanText.lastIndexOf(' ', chunkEnd)
        if (lastSpace > chunkStart + opts.chunkSize * 0.8) {
          chunkEnd = lastSpace
        }
      }
    }
    
    // Extract chunk text
    const chunkText = cleanText.substring(chunkStart, chunkEnd).trim()
    
    // Get context (100 chars before and after)
    const contextStart = Math.max(0, chunkStart - 100)
    const contextEnd = Math.min(cleanText.length, chunkEnd + 100)
    
    const precedingContext = chunkStart > 0 
      ? '...' + cleanText.substring(contextStart, chunkStart).trim()
      : ''
    
    const followingContext = chunkEnd < cleanText.length
      ? cleanText.substring(chunkEnd, contextEnd).trim() + '...'
      : ''
    
    // Detect section context (look for headers)
    const textBefore = cleanText.substring(0, chunkStart)
    const sectionContext = detectSectionContext(textBefore)
    
    chunks.push({
      text: chunkText,
      metadata: {
        start_char: chunkStart,
        end_char: chunkEnd,
        chunk_index: chunkIndex,
        section_context: sectionContext,
        preceding_context: precedingContext,
        following_context: followingContext
      }
    })
    
    // Move to next chunk with overlap
    currentPosition = chunkEnd - opts.overlapSize
    chunkIndex++
    
    // Safety check to prevent infinite loops
    if (currentPosition <= chunkStart) {
      currentPosition = chunkEnd
    }
  }
  
  return chunks
}

/**
 * Try to detect section headers in the text before the chunk
 */
function detectSectionContext(textBefore: string): string | undefined {
  // Look for common header patterns in the last 500 chars
  const searchText = textBefore.slice(-500)
  
  // Patterns for headers (reversed to find the most recent)
  const headerPatterns = [
    /\n#{1,6}\s+(.+)/g,              // Markdown headers
    /\n([A-Z][A-Z\s]{2,})\n/g,       // ALL CAPS headers
    /\n(\d+\.?\s+[A-Z].{2,50})\n/g,  // Numbered sections
    /\n([A-Z][^.!?]{2,50}:)\s/g      // Headers ending with colon
  ]
  
  let lastHeader: string | undefined
  
  for (const pattern of headerPatterns) {
    const matches = [...searchText.matchAll(pattern)]
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1]
      const header = lastMatch[1].trim()
      if (header.length > 2 && header.length < 100) {
        lastHeader = header
        break
      }
    }
  }
  
  return lastHeader
}

/**
 * Estimate token count (rough approximation)
 * OpenAI uses ~4 characters per token on average
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}