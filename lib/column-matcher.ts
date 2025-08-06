// lib/column-matcher.ts

import OpenAI from 'openai'
import { ColumnMatchResult } from './spreadsheet-search-types'

export class ColumnMatcher {
  private openai: OpenAI
  private synonymMap: Map<string, string[]>
  
  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })
    }
    
    // Common synonyms for faster matching
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
      
      // Try semantic match using OpenAI if available
      if ((!match || match.confidence < 0.7) && this.openai) {
        try {
          const semanticMatch = await this.semanticMatch(target, availableColumns)
          if (!match || semanticMatch.confidence > match.confidence) {
            match = semanticMatch
          }
        } catch (error) {
          console.error('Semantic match failed:', error)
        }
      }
      
      // Try pattern matching on data if available
      if ((!match || match.confidence < 0.6) && sampleData) {
        const patternMatch = this.patternMatch(target, availableColumns, sampleData)
        if (!match || patternMatch.confidence > match.confidence) {
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
   * Fuzzy match using Levenshtein distance
   */
  private fuzzyMatch(
    target: string,
    columns: Array<{ name: string; index: number }>
  ): ColumnMatchResult | null {
    const normalizedTarget = this.normalizeColumnName(target)
    let bestMatch: ColumnMatchResult | null = null
    let bestScore = 0
    
    for (const col of columns) {
      const normalizedCol = this.normalizeColumnName(col.name)
      const distance = this.levenshteinDistance(normalizedTarget, normalizedCol)
      const maxLen = Math.max(normalizedTarget.length, normalizedCol.length)
      const score = 1 - (distance / maxLen)
      
      if (score > bestScore && score > 0.7) {
        bestScore = score
        bestMatch = {
          column: col.name,
          index: col.index,
          confidence: score * 0.9, // Slightly reduce confidence for fuzzy matches
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
          confidence: match.confidence * 0.85, // Reduce confidence for synonym matches
          method: 'fuzzy' as const
        }
      }
    }
    
    return null
  }
  
  /**
   * Semantic match using OpenAI embeddings or chat
   */
  private async semanticMatch(
    target: string,
    columns: Array<{ name: string; index: number }>
  ): Promise<ColumnMatchResult | null> {
    const prompt = `
Given the target column: "${target}"
And available columns: ${columns.map(c => c.name).join(', ')}

Which column best matches the target semantically? Consider:
- Similar meanings (e.g., "vendor" matches "supplier")
- Language variations (e.g. Thai query "ผู้ขาย" matches Eng column "vendor")
- Language variations (e.g. Eng query "vendor" matches Thai column "ผู้ขาย")
- Contextual relevance (e.g., "amount" matches "total")
- Common abbreviations (e.g., "amt" matches "amount")
- Domain-specific terms

Return the best match as JSON:
{
  "matchedColumn": "column name",
  "confidence": 0.8,
  "reason": "why it matches"
}

If no good match exists, return {"matchedColumn": null}
`

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a data analyst expert at matching column names. Only match columns that are truly semantically related.'
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
        const matchedCol = columns.find(c => 
          this.normalizeColumnName(c.name) === this.normalizeColumnName(response.matchedColumn)
        )
        
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
          // Vendor names are typically 2-100 chars, may contain letters, numbers, spaces, and common business chars
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
   * Normalize column names for comparison
   */
  private normalizeColumnName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[_\-\s]+/g, '') // Remove separators
      .replace(/\W+/g, '') // Remove non-word chars
      .trim()
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
}