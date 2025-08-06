// lib/column-matcher.ts

import OpenAI from 'openai'
import { ColumnMatchResult } from './spreadsheet-search-types'

export class ColumnMatcher {
  private openai: OpenAI
  private synonymMap: Map<string, string[]>
  private conceptCache: Map<string, string[]>
  private embeddingCache: Map<string, number[]>
  
  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })
    }
    
    // Initialize caches
    this.conceptCache = new Map()
    this.embeddingCache = new Map()
    
    // Common synonyms for faster matching (keeping for backwards compatibility)
    this.synonymMap = new Map([
      ['vendor', ['supplier', 'provider', 'merchant', 'seller', 'company']],
      ['customer', ['client', 'buyer', 'purchaser', 'account']],
      ['payment', ['transaction', 'transfer', 'remittance', 'disbursement']],
      ['amount', ['total', 'sum', 'value', 'price', 'cost']],
      ['date', ['time', 'timestamp', 'when', 'period', 'datetime']],
      ['invoice', ['bill', 'receipt', 'statement']],
      ['name', ['title', 'label', 'description']],
      ['email', ['e-mail', 'mail', 'email_address', 'contact']],
      ['phone', ['telephone', 'mobile', 'cell', 'number', 'contact']]
    ])
  }
  
  /**
   * Match target columns to available columns using multiple strategies
   */
  async matchColumns(
    targetColumns: string[],
    availableColumns: Array<{ name: string; index: number; dataType?: string }>,
    sampleData?: any[][]
  ): Promise<ColumnMatchResult[]> {
    const matches: ColumnMatchResult[] = []
    
    for (const target of targetColumns) {
      // Try exact match first
      let match = this.exactMatch(target, availableColumns)
      
      // Try fuzzy match if no exact match
      if (!match || match.confidence < 0.9) {
        const fuzzyMatch = this.fuzzyMatch(target, availableColumns)
        if (!match || fuzzyMatch.confidence > match.confidence) {
          match = fuzzyMatch
        }
      }
      
      // Try synonym match
      if (!match || match.confidence < 0.8) {
        const synonymMatch = this.synonymMatch(target, availableColumns)
        if (!match || synonymMatch.confidence > match.confidence) {
          match = synonymMatch
        }
      }
      
      // Try embeddings match for cross-language support
      if ((!match || match.confidence < 0.7) && this.openai) {
        try {
          const embeddingsMatch = await this.embeddingsMatch(target, availableColumns)
          if (!match || (embeddingsMatch && embeddingsMatch.confidence > match.confidence)) {
            match = embeddingsMatch
          }
        } catch (error) {
          console.error('Embeddings match failed:', error)
        }
      }
      
      // Try semantic match using GPT
      if ((!match || match.confidence < 0.7) && this.openai) {
        try {
          const semanticMatch = await this.semanticMatch(target, availableColumns)
          if (!match || (semanticMatch && semanticMatch.confidence > match.confidence)) {
            match = semanticMatch
          }
        } catch (error) {
          console.error('Semantic match failed:', error)
        }
      }
      
      // Try pattern matching on data if available
      if ((!match || match.confidence < 0.6) && sampleData) {
        const patternMatch = await this.enhancedPatternMatch(target, availableColumns, sampleData)
        if (!match || (patternMatch && patternMatch.confidence > match.confidence)) {
          match = patternMatch
        }
      }
      
      if (match && match.confidence > 0.5) {
        matches.push(match)
      }
    }
    
    return matches
  }
  
  /**
   * Exact match (case-insensitive)
   */
  private exactMatch(
    target: string,
    columns: Array<{ name: string; index: number }>
  ): ColumnMatchResult | null {
    const normalizedTarget = this.normalizeColumnName(target)
    
    for (const col of columns) {
      const normalizedCol = this.normalizeColumnName(col.name)
      if (normalizedCol === normalizedTarget) {
        return {
          column: col.name,
          index: col.index,
          confidence: 1.0,
          method: 'exact'
        }
      }
    }
    
    return null
  }
  
  /**
   * Fuzzy match using Levenshtein distance with script awareness
   */
  private fuzzyMatch(
    target: string,
    columns: Array<{ name: string; index: number }>
  ): ColumnMatchResult | null {
    const targetInfo = this.normalizeForComparison(target)
    let bestMatch: ColumnMatchResult | null = null
    let bestScore = 0
    
    for (const col of columns) {
      const colInfo = this.normalizeForComparison(col.name)
      
      // Skip fuzzy matching between different scripts (won't be meaningful)
      if (targetInfo.script !== colInfo.script && 
          targetInfo.hasNonLatin && colInfo.hasNonLatin) {
        continue
      }
      
      const distance = this.levenshteinDistance(
        targetInfo.normalized, 
        colInfo.normalized
      )
      const maxLen = Math.max(
        targetInfo.normalized.length, 
        colInfo.normalized.length
      )
      const score = 1 - (distance / maxLen)
      
      if (score > bestScore && score > 0.7) {
        bestScore = score
        bestMatch = {
          column: col.name,
          index: col.index,
          confidence: score * 0.9,
          method: 'fuzzy'
        }
      }
    }
    
    return bestMatch
  }
  
  /**
   * Match using synonym dictionary
   */
  private synonymMatch(
    target: string,
    columns: Array<{ name: string; index: number }>
  ): ColumnMatchResult | null {
    const normalizedTarget = this.normalizeColumnName(target)
    const synonyms = this.synonymMap.get(normalizedTarget) || []
    
    // Also check if target is a synonym of any key
    for (const [key, syns] of this.synonymMap.entries()) {
      if (syns.includes(normalizedTarget)) {
        synonyms.push(key)
      }
    }
    
    for (const synonym of synonyms) {
      const match = this.exactMatch(synonym, columns)
      if (match) {
        return {
          ...match,
          confidence: match.confidence * 0.85,
          method: 'fuzzy' as const
        }
      }
    }
    
    return null
  }
  
  /**
   * Match columns using embeddings for language-agnostic semantic similarity
   */
  private async embeddingsMatch(
    target: string,
    columns: Array<{ name: string; index: number }>
  ): Promise<ColumnMatchResult | null> {
    try {
      // Get cached or generate embedding for target
      const targetEmbedding = await this.getEmbedding(`Column name: ${target}`)
      
      // Get embeddings for all columns
      const columnEmbeddings = await Promise.all(
        columns.map(async (col) => ({
          column: col,
          embedding: await this.getEmbedding(`Column name: ${col.name}`)
        }))
      )
      
      // Calculate cosine similarities
      const similarities = columnEmbeddings.map(({ column, embedding }) => ({
        column,
        similarity: this.cosineSimilarity(targetEmbedding, embedding)
      }))
      
      // Find best match
      const bestMatch = similarities.reduce((best, current) => 
        current.similarity > best.similarity ? current : best
      )
      
      // Only return if similarity is high enough
      if (bestMatch.similarity > 0.8) {
        return {
          column: bestMatch.column.name,
          index: bestMatch.column.index,
          confidence: bestMatch.similarity,
          method: 'semantic'
        }
      }
    } catch (error) {
      console.error('Embeddings match error:', error)
    }
    
    return null
  }
  
  /**
   * Get embedding with caching
   */
  private async getEmbedding(text: string): Promise<number[]> {
    const cacheKey = `emb_${text.toLowerCase()}`
    
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!
    }
    
    const response = await this.openai.embeddings.create({
      model: process.env.OPENAI_MODEL_EMBEDDINGS || 'text-embedding-3-small',
      input: text
    })
    
    const embedding = response.data[0].embedding
    this.embeddingCache.set(cacheKey, embedding)
    
    return embedding
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
    return dotProduct / (magnitudeA * magnitudeB)
  }
  
  /**
   * Enhanced semantic match using OpenAI with multilingual support
   */
  private async semanticMatch(
    target: string,
    columns: Array<{ name: string; index: number }>
  ): Promise<ColumnMatchResult | null> {
    const prompt = `
You are a multilingual data analyst expert at matching column names across different languages.

Target column concept: "${target}"
Available columns: ${columns.map(c => `"${c.name}"`).join(', ')}

Your task:
1. Understand the semantic meaning of the target column (e.g., "payment" refers to financial transactions)
2. Find columns that represent the SAME CONCEPT regardless of language
3. Consider these matching scenarios:
   - Direct translations (e.g., "payment" = "การชำระเงิน" in Thai, "支払い" in Japanese, "pago" in Spanish)
   - Semantic equivalents (e.g., "vendor" = "supplier" = "ผู้ขาย" = "プロバイダー")
   - Common abbreviations in any language
   - Transliterations and romanizations
   - Mixed language columns (e.g., "Payment_การชำระ")

Important: The target is in English but columns might be in ANY language. You must match based on meaning, not spelling.

Return the best match as JSON:
{
  "matchedColumn": "exact column name as it appears",
  "confidence": 0.9,
  "reason": "why it matches (mention if it's a translation)"
}

If no semantically equivalent column exists, return {"matchedColumn": null}
`

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a multilingual data expert fluent in multiple languages including English, Thai, Japanese, Chinese, Spanish, French, German, and others. Match columns based on semantic meaning across languages.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: 200
      })
      
      const response = JSON.parse(completion.choices[0].message.content || '{}')
      
      if (response.matchedColumn) {
        const matchedCol = columns.find(c => c.name === response.matchedColumn)
        
        if (matchedCol) {
          return {
            column: matchedCol.name,
            index: matchedCol.index,
            confidence: response.confidence || 0.7,
            method: 'semantic'
          }
        }
      }
    } catch (error) {
      console.error('Semantic match error:', error)
    }
    
    return null
  }
  
  /**
   * Enhanced pattern match with concept expansion
   */
  private async enhancedPatternMatch(
    target: string,
    columns: Array<{ name: string; index: number; dataType?: string }>,
    sampleData: any[][]
  ): Promise<ColumnMatchResult | null> {
    // First, expand the target concept
    const expandedConcepts = await this.expandConcept(target)
    
    // Try pattern matching with each expanded concept
    let bestMatch: ColumnMatchResult | null = null
    
    for (const concept of expandedConcepts) {
      const match = this.patternMatch(concept, columns, sampleData)
      if (match && (!bestMatch || match.confidence > bestMatch.confidence)) {
        bestMatch = match
      }
    }
    
    return bestMatch
  }
  
  /**
   * Pattern match based on data content
   */
  private patternMatch(
    target: string,
    columns: Array<{ name: string; index: number; dataType?: string }>,
    sampleData: any[][]
  ): ColumnMatchResult | null {
    const normalizedTarget = this.normalizeColumnName(target)
    const patterns = this.getDataPatterns(normalizedTarget)
    
    if (!patterns || sampleData.length < 5) {
      return null
    }
    
    let bestMatch: ColumnMatchResult | null = null
    let bestScore = 0
    
    for (const col of columns) {
      // Skip if column has a good name match already
      if (col.name && col.name.trim() !== '' && col.name !== `Column ${col.index + 1}`) {
        continue
      }
      
      // Sample up to 20 non-empty values from this column
      const columnValues: any[] = []
      for (const row of sampleData) {
        if (row[col.index] !== null && row[col.index] !== undefined && row[col.index] !== '') {
          columnValues.push(row[col.index])
          if (columnValues.length >= 20) break
        }
      }
      
      if (columnValues.length < 3) continue
      
      // Check patterns
      const score = this.scorePatternMatch(columnValues, patterns)
      
      if (score > bestScore && score > 0.6) {
        bestScore = score
        bestMatch = {
          column: col.name || `Column ${col.index + 1}`,
          index: col.index,
          confidence: score,
          method: 'pattern'
        }
      }
    }
    
    return bestMatch
  }
  
  /**
   * Expand a concept to include multilingual variations and synonyms
   */
  private async expandConcept(concept: string): Promise<string[]> {
    if (!this.openai) return [concept]
    
    const cacheKey = `concept_${concept.toLowerCase()}`
    
    if (this.conceptCache.has(cacheKey)) {
      return this.conceptCache.get(cacheKey)!
    }
    
    try {
      const prompt = `
Given the column concept "${concept}", provide common variations including:
1. Direct translations in major languages (Thai, Japanese, Chinese, Spanish, etc.)
2. Common synonyms in English
3. Common abbreviations
4. Related business terms

Focus on terms commonly used in business spreadsheets and databases.

Return as JSON array of strings:
["term1", "term2", "การชำระเงิน", "支払い", ...]

Limit to 10-15 most relevant variations.
`
      
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a multilingual business data expert. Provide concise, relevant term variations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
      
      const variations = JSON.parse(completion.choices[0].message.content || '[]')
      
      // Always include the original concept
      const results = [concept, ...variations].filter((v, i, arr) => 
        v && arr.indexOf(v) === i // Remove duplicates
      )
      
      this.conceptCache.set(cacheKey, results)
      
      return results
    } catch (error) {
      console.error('Concept expansion error:', error)
      return [concept]
    }
  }
  
  /**
   * Get data patterns for common column types
   */
  private getDataPatterns(columnType: string): {
    regex?: RegExp[]
    validator?: (value: any) => boolean
    minMatches?: number
  } | null {
    const patterns: Record<string, any> = {
      email: {
        regex: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/],
        minMatches: 0.8
      },
      phone: {
        regex: [
          /^\+?\d{10,15}$/,
          /^\(\d{3}\)\s?\d{3}-?\d{4}$/,
          /^\d{3}-\d{3}-\d{4}$/
        ],
        minMatches: 0.7
      },
      date: {
        validator: (v: any) => !isNaN(Date.parse(String(v))),
        minMatches: 0.8
      },
      amount: {
        validator: (v: any) => {
          const str = String(v).replace(/[$,]/g, '')
          return !isNaN(parseFloat(str))
        },
        minMatches: 0.9
      },
      vendor: {
        validator: (v: any) => {
          const str = String(v)
          return str.length >= 2 && str.length <= 100 && /^[a-zA-Z0-9\s\-&.,\']+$/.test(str)
        },
        minMatches: 0.7
      }
    }
    
    return patterns[columnType] || null
  }
  
  /**
   * Score how well column data matches expected patterns
   */
  private scorePatternMatch(
    values: any[],
    patterns: { regex?: RegExp[]; validator?: (v: any) => boolean; minMatches?: number }
  ): number {
    let matches = 0
    
    for (const value of values) {
      const strValue = String(value).trim()
      
      if (patterns.regex) {
        if (patterns.regex.some(r => r.test(strValue))) {
          matches++
        }
      } else if (patterns.validator) {
        if (patterns.validator(value)) {
          matches++
        }
      }
    }
    
    const matchRatio = matches / values.length
    return matchRatio >= (patterns.minMatches || 0.7) ? matchRatio : 0
  }
  
  /**
   * Normalize column names for comparison while preserving non-English characters
   */
  private normalizeColumnName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[\s_\-]+/g, '') // Remove spaces, underscores, hyphens
  }
  
  /**
   * More sophisticated normalization that handles multiple scripts
   */
  private normalizeForComparison(name: string): {
    normalized: string
    original: string
    hasNonLatin: boolean
    script?: string
  } {
    const original = name.trim()
    
    // Basic normalization
    let normalized = original.toLowerCase()
    
    // Detect script type
    const hasNonLatin = /[^\u0000-\u007F]/.test(original)
    let script = 'latin'
    
    if (/[\u0E00-\u0E7F]/.test(original)) script = 'thai'
    else if (/[\u3040-\u309F\u30A0-\u30FF]/.test(original)) script = 'japanese'
    else if (/[\u4E00-\u9FFF]/.test(original)) script = 'chinese'
    else if (/[\u0600-\u06FF]/.test(original)) script = 'arabic'
    else if (/[\u0400-\u04FF]/.test(original)) script = 'cyrillic'
    
    // Only aggressively normalize Latin text
    if (!hasNonLatin) {
      normalized = normalized.replace(/[_\-\s]+/g, '').replace(/\W+/g, '')
    } else {
      // For non-Latin scripts, only remove obvious separators
      normalized = normalized.replace(/[_\-\s]+/g, '')
    }
    
    return {
      normalized,
      original,
      hasNonLatin,
      script
    }
  }
  
  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = []
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i]
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          )
        }
      }
    }
    
    return matrix[b.length][a.length]
  }
  
  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.conceptCache.clear()
    this.embeddingCache.clear()
  }
}