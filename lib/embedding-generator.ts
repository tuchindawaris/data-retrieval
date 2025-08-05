import OpenAI from 'openai'
import { ChunkWithMetadata } from './document-chunker'

export interface EmbeddingResult {
  fileId: string
  embeddings: {
    chunk_index: number
    chunk_text: string
    embedding: number[]
    metadata: ChunkWithMetadata['metadata']
  }[]
}

export interface BatchEmbeddingResult {
  results: EmbeddingResult[]
  totalTokens: number
  errors: {
    fileId: string
    error: string
  }[]
}

/**
 * Generate embeddings for document chunks using OpenAI
 */
export async function generateEmbeddings(
  files: {
    fileId: string
    chunks: ChunkWithMetadata[]
  }[],
  options: {
    batchSize?: number
    model?: string
  } = {}
): Promise<BatchEmbeddingResult> {
  const { 
    batchSize = 20, // Process 20 chunks at a time
    model = 'text-embedding-3-small' 
  } = options
  
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured')
  }
  
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
  
  const results: EmbeddingResult[] = []
  const errors: { fileId: string; error: string }[] = []
  let totalTokens = 0
  
  console.log(`Generating embeddings for ${files.length} files...`)
  
  // Process each file
  for (const file of files) {
    try {
      console.log(`Processing ${file.fileId}: ${file.chunks.length} chunks`)
      
      const fileEmbeddings: EmbeddingResult['embeddings'] = []
      
      // Process chunks in batches
      for (let i = 0; i < file.chunks.length; i += batchSize) {
        const batch = file.chunks.slice(i, i + batchSize)
        const texts = batch.map(chunk => chunk.text)
        
        try {
          console.log(`  Embedding chunks ${i + 1}-${Math.min(i + batchSize, file.chunks.length)}...`)
          
          const response = await openai.embeddings.create({
            model,
            input: texts,
          })
          
          // Add embeddings to results
          response.data.forEach((embedding, index) => {
            const chunk = batch[index]
            fileEmbeddings.push({
              chunk_index: chunk.metadata.chunk_index,
              chunk_text: chunk.text,
              embedding: embedding.embedding,
              metadata: chunk.metadata
            })
          })
          
          totalTokens += response.usage?.total_tokens || 0
          
          // Small delay to respect rate limits
          if (i + batchSize < file.chunks.length) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          
        } catch (error: any) {
          console.error(`  Error embedding batch starting at ${i}:`, error.message)
          // Continue with other chunks even if one batch fails
          batch.forEach(chunk => {
            errors.push({
              fileId: file.fileId,
              error: `Failed to embed chunk ${chunk.metadata.chunk_index}: ${error.message}`
            })
          })
        }
      }
      
      if (fileEmbeddings.length > 0) {
        results.push({
          fileId: file.fileId,
          embeddings: fileEmbeddings
        })
      }
      
    } catch (error: any) {
      console.error(`Error processing file ${file.fileId}:`, error.message)
      errors.push({
        fileId: file.fileId,
        error: error.message
      })
    }
  }
  
  console.log(`Embedding generation complete:`)
  console.log(`  - Files processed: ${results.length}`)
  console.log(`  - Total chunks: ${results.reduce((sum, r) => sum + r.embeddings.length, 0)}`)
  console.log(`  - Total tokens: ${totalTokens}`)
  console.log(`  - Errors: ${errors.length}`)
  
  return {
    results,
    totalTokens,
    errors
  }
}

/**
 * Generate a single embedding for a search query
 */
export async function generateQueryEmbedding(
  query: string,
  model: string = 'text-embedding-3-small'
): Promise<number[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured')
  }
  
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
  
  const response = await openai.embeddings.create({
    model,
    input: query,
  })
  
  return response.data[0].embedding
}