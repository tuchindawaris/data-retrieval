// lib/spreadsheet-search-analyzer.ts

import OpenAI from 'openai'
import { 
  SearchIntent, 
  SheetMatch, 
  SpreadsheetSearchRequest 
} from './spreadsheet-search-types'
import { FileMetadata } from './supabase'

export class SpreadsheetSearchAnalyzer {
  private openai: OpenAI
  private conceptCache: Map<string, string[]>
  
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured')
    }
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
    
    this.conceptCache = new Map()
  }
  
  /**
   * Analyze query intent with multilingual awareness
   */
  async analyzeQueryIntent(query: string): Promise<SearchIntent> {
  const prompt = `
Analyze this spreadsheet search query to understand the user's intent.
Query: "${query}"

Important: 
1. The query might be in any language
2. Identify the KEY COLUMN - this is usually the column after prepositions like "by", "per", "for each", "grouped by"
3. The key column is what the user wants to group or filter the data by

Your task:
1. Identify the search type (lookup, filter, aggregate, or list)
2. Extract the CONCEPTUAL column targets (not just literal words)
3. IMPORTANT: Identify the KEY COLUMN if present
4. Understand filters and aggregations

Pattern recognition for KEY COLUMN:
- "payment amount BY vendor" → key column: vendor
- "sales PER region" → key column: region
- "total revenue FOR EACH customer" → key column: customer
- "expenses GROUPED BY category" → key column: category
- "ยอดขายตามเดือน" (Thai: sales by month) → key column: month/เดือน
- "顧客別の売上" (Japanese: sales by customer) → key column: customer/顧客

For target columns and key column:
- Extract the core CONCEPTS being searched for
- Include multiple language variations
- The KEY COLUMN is critical for filtering - we'll only show rows where this column has values

Return JSON format:
{
  "type": "lookup" | "filter" | "aggregate" | "list",
  "targetColumns": [
    "payment", "การชำระเงิน", "支払い", "pago", "付款",
    "amount", "จำนวนเงิน", "金額", "monto", "金额"
  ],
  "keyColumn": "vendor", // or "ผู้ขาย", "仕入先", etc. - the grouping column
  "filters": [...],
  "aggregations": [...]
}

If there's no clear "by/per/for each" pattern, keyColumn can be null.
`

  try {
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a multilingual data analyst expert at understanding query patterns. Pay special attention to identifying the KEY COLUMN that data should be grouped or filtered by.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 800
    })
    
    const response = JSON.parse(completion.choices[0].message.content || '{}')
    
    // Validate and enhance target columns
    let targetColumns = response.targetColumns || []
    
    // If we got very few target columns, try to expand them
    if (targetColumns.length < 3 && targetColumns.length > 0) {
      const expandedColumns = await this.expandTargetColumns(targetColumns)
      targetColumns = [...new Set([...targetColumns, ...expandedColumns])]
    }
    
    // If keyColumn is identified, ensure it's also in targetColumns
    if (response.keyColumn && !targetColumns.includes(response.keyColumn)) {
      targetColumns.push(response.keyColumn)
    }
    
    return {
      type: response.type || 'lookup',
      targetColumns,
      keyColumn: response.keyColumn || null,
      filters: response.filters || [],
      aggregations: response.aggregations || []
    }
  } catch (error) {
    console.error('Error analyzing query intent:', error)
    // Fallback to basic keyword analysis
    return this.fallbackIntentAnalysis(query)
  }
}

  
  /**
   * Expand target columns to include multilingual variations
   */
  private async expandTargetColumns(columns: string[]): Promise<string[]> {
    const expanded: string[] = []
    
    for (const col of columns) {
      const variations = await this.getConceptVariations(col)
      expanded.push(...variations)
    }
    
    return expanded
  }
  
  /**
   * Get multilingual variations of a concept
   */
  private async getConceptVariations(concept: string): Promise<string[]> {
    const cacheKey = `concept_${concept.toLowerCase()}`
    
    if (this.conceptCache.has(cacheKey)) {
      return this.conceptCache.get(cacheKey)!
    }
    
    try {
      const prompt = `
For the business/data concept "${concept}", provide 5-8 common variations including:
1. Translations in Thai, Japanese, Chinese, Spanish
2. Common English synonyms
3. Common abbreviations

Return as JSON array: ["term1", "term2", ...]
Focus on terms used in business spreadsheets.
`
      
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Provide concise multilingual business term variations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      })
      
      const variations = JSON.parse(completion.choices[0].message.content || '[]')
      const results = [concept, ...variations].filter((v, i, arr) => 
        v && arr.indexOf(v) === i
      )
      
      this.conceptCache.set(cacheKey, results)
      return results
    } catch (error) {
      console.error('Error getting concept variations:', error)
      return [concept]
    }
  }
  
  /**
   * Match sheets to query with multilingual awareness
   */
  async matchSheetsToQuery(
    query: string,
    files: FileMetadata[],
    intent: SearchIntent
  ): Promise<SheetMatch[]> {
    // Filter to only spreadsheet files
    const spreadsheets = files.filter(f => 
      f.metadata?.isSpreadsheet && 
      f.metadata?.sheets && 
      f.metadata.sheets.length > 0
    )
    
    if (spreadsheets.length === 0) {
      return []
    }
    
    // Build schema summary for GPT
    const schemaSummary = this.buildSchemaSummary(spreadsheets)
    
    const prompt = `
Given the search query: "${query}"
And the search intent: ${JSON.stringify(intent)}

Analyze these spreadsheet schemas and identify which sheets likely contain relevant data.
Consider that:
1. The query might be in any language
2. Column names might be in different languages than the query
3. You should match based on semantic meaning, not literal text

${schemaSummary}

For each relevant sheet, provide:
1. Relevance score (0-1) based on:
   - How well the columns match the search intent semantically
   - Presence of data that could answer the query
   - Consider multilingual column names as positive matches
2. Reasons why it matches (be specific about which columns match)
3. Which columns are most relevant

Return JSON array of matches:
[{
  "fileId": "xxx",
  "fileName": "xxx", 
  "sheetName": "xxx",
  "sheetIndex": 0,
  "relevanceScore": 0.95,
  "matchReasons": ["Contains payment column (การชำระเงิน)", "Has amount data (จำนวนเงิน)"],
  "relevantColumns": ["การชำระเงิน", "จำนวนเงิน", "Payment Terms"]
}]

Only include sheets with relevance score > 0.5
Prioritize sheets that have columns matching the target concepts, regardless of language.
`

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a multilingual data analyst expert at matching queries to spreadsheet schemas across different languages. Recognize that "payment" and "การชำระเงิน" refer to the same concept. Be accurate and match based on semantic meaning.'
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
      
      const response = JSON.parse(completion.choices[0].message.content || '{"matches": []}')
      const matches = response.matches || response || []
      
      // Validate and enhance matches
      return matches
        .filter((m: any) => m.relevanceScore > 0.5)
        .map((m: any) => ({
          fileId: m.fileId,
          fileName: m.fileName,
          sheetName: m.sheetName,
          sheetIndex: m.sheetIndex || 0,
          relevanceScore: Math.min(1, Math.max(0, m.relevanceScore)),
          matchReasons: m.matchReasons || []
        }))
        .sort((a: SheetMatch, b: SheetMatch) => b.relevanceScore - a.relevanceScore)
        
    } catch (error) {
      console.error('Error matching sheets:', error)
      // Fallback to enhanced keyword matching
      return this.fallbackSheetMatching(query, spreadsheets, intent)
    }
  }
  
  /**
   * Build schema summary with emphasis on column information
   */
  private buildSchemaSummary(spreadsheets: FileMetadata[]): string {
    const summaries: string[] = []
    
    for (const file of spreadsheets) {
      const sheets = file.metadata?.sheets || []
      
      for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
        const sheet = sheets[sheetIndex]
        const columns = sheet.columns?.filter((c: any) => c).slice(0, 20) || []
        
        // Include more context about columns
        const columnDetails = columns.map((c: any) => {
          const dataInfo = c.dataType ? ` (${c.dataType})` : ''
          const nonEmpty = c.nonEmptyRows ? ` [${c.nonEmptyRows} rows]` : ''
          return `${c.name}${dataInfo}${nonEmpty}`
        }).join(', ')
        
        summaries.push(`
File ID: ${file.file_id}
File Name: ${file.name}
Sheet Name: ${sheet.name}
Sheet Index: ${sheetIndex}
Total Rows: ${sheet.totalRows || 0}
Columns: ${columnDetails}
${file.metadata?.summary ? `File Summary: ${file.metadata.summary}` : ''}
${sheet.summary ? `Sheet Summary: ${sheet.summary}` : ''}
---`)
      }
    }
    
    return summaries.join('\n')
  }
  
  /**
   * Enhanced fallback intent analysis with better multilingual support
   */
  private fallbackIntentAnalysis(query: string): SearchIntent {
    const lowerQuery = query.toLowerCase()
    
    // Detect aggregation keywords in multiple languages
    const aggregationKeywords = [
        'total', 'sum', 'count', 'average', 'avg', 'min', 'max',
        'รวม', 'ผลรวม', 'นับ', 'เฉลี่ย', // Thai
        '合計', '総計', 'カウント', '平均', // Japanese
        'suma', 'contar', 'promedio', // Spanish
        '总计', '求和', '计数', '平均' // Chinese
    ]
    const hasAggregation = aggregationKeywords.some(k => lowerQuery.includes(k))
    
    // Detect filter keywords in multiple languages
    const filterKeywords = [
        'over', 'under', 'greater', 'less', 'between', 'last', 'this',
        'มากกว่า', 'น้อยกว่า', 'ระหว่าง', 'ล่าสุด', // Thai
        '以上', '以下', '之间', '最近', // Chinese
        'より大きい', 'より小さい', '間', '最近' // Japanese
    ]
    const hasFilter = filterKeywords.some(k => lowerQuery.includes(k))
    
    // Detect lookup keywords
    const lookupKeywords = [
        'by', 'for', 'find', 'search', 'lookup', 'get',
        'ตาม', 'หา', 'ค้นหา', // Thai
        'による', '検索', '探す', // Japanese
        'por', 'buscar', 'encontrar' // Spanish
    ]
    const hasLookup = lookupKeywords.some(k => lowerQuery.includes(k))
    
    // Extract key column using patterns
    let keyColumn: string | undefined
    
    // Pattern: "X by Y" or "X per Y" or "X for each Y"
    const keyColumnPatterns = [
        /\b(?:by|per|for each|grouped by)\s+(\w+)/i,
        /\bตาม\s*(\S+)/i, // Thai: ตาม (by)
        /\bによる\s*(\S+)/i, // Japanese: による (by)
        /\bpor\s+(\w+)/i, // Spanish: por (by)
        /\b按\s*(\S+)/i, // Chinese: 按 (by)
    ]
    
    for (const pattern of keyColumnPatterns) {
        const match = lowerQuery.match(pattern)
        if (match && match[1]) {
        keyColumn = match[1].trim()
        break
        }
    }
    
    // Extract potential column names (enhanced for multilingual)
    const commonColumns = [
        'vendor', 'supplier', 'customer', 'client', 'payment', 'amount',
        'invoice', 'date', 'name', 'email', 'phone', 'address', 'total',
        'price', 'cost', 'quantity', 'product', 'service', 'description',
        'category', 'region', 'month', 'year', 'term', 'terms',
        // Add some common non-English terms
        'ผู้ขาย', 'ลูกค้า', 'การชำระเงิน', 'จำนวน', 'วันที่', 'เดือน', // Thai
        '顧客', '支払い', '金額', '日付', '月', // Japanese
        'cliente', 'pago', 'cantidad', 'fecha', 'mes' // Spanish
    ]
    
    const targetColumns = commonColumns.filter(col => {
        const normalized = col.toLowerCase()
        return lowerQuery.includes(normalized) || 
            lowerQuery.includes(normalized + 's') || 
            lowerQuery.includes(normalized.replace('_', ' '))
    })
    
    // If we found a key column, ensure it's in target columns
    if (keyColumn && !targetColumns.includes(keyColumn)) {
        targetColumns.push(keyColumn)
    }
    
    let type: SearchIntent['type'] = 'list'
    if (hasAggregation) type = 'aggregate'
    else if (hasFilter) type = 'filter'
    else if (hasLookup) type = 'lookup'
    
    return {
        type,
        targetColumns,
        keyColumn,
        filters: [],
        aggregations: hasAggregation ? ['sum'] : []
    }
    }

  
  /**
   * Enhanced fallback sheet matching with better multilingual support
   */
  private fallbackSheetMatching(
    query: string,
    spreadsheets: FileMetadata[],
    intent: SearchIntent
  ): SheetMatch[] {
    const lowerQuery = query.toLowerCase()
    const queryWords = this.tokenizeMultilingual(lowerQuery)
    const targetWords = intent.targetColumns.map(c => c.toLowerCase())
    
    const matches: SheetMatch[] = []
    
    for (const file of spreadsheets) {
      const sheets = file.metadata?.sheets || []
      
      for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
        const sheet = sheets[sheetIndex]
        const columns = sheet.columns?.filter((c: any) => c) || []
        
        let score = 0
        const reasons: string[] = []
        
        // Check sheet name
        const sheetNameWords = this.tokenizeMultilingual(sheet.name?.toLowerCase() || '')
        if (this.hasWordOverlap(sheetNameWords, queryWords)) {
          score += 0.3
          reasons.push('Sheet name matches query')
        }
        
        // Check column names with better multilingual support
        const columnNames = columns.map((c: any) => c.name?.toLowerCase() || '')
        
        // Check for target column matches
        for (const target of targetWords) {
          const targetTokens = this.tokenizeMultilingual(target)
          
          for (const colName of columnNames) {
            const colTokens = this.tokenizeMultilingual(colName)
            
            if (this.hasWordOverlap(targetTokens, colTokens)) {
              score += 0.4
              reasons.push(`Contains relevant column: ${colName}`)
              break
            }
          }
        }
        
        // Check file name
        const fileNameWords = this.tokenizeMultilingual(file.name.toLowerCase())
        if (this.hasWordOverlap(fileNameWords, queryWords)) {
          score += 0.2
          reasons.push('File name matches query')
        }
        
        // Check summary
        if (file.metadata?.summary) {
          const summaryWords = this.tokenizeMultilingual(file.metadata.summary.toLowerCase())
          if (this.hasWordOverlap(summaryWords, queryWords)) {
            score += 0.1
            reasons.push('Summary mentions query terms')
          }
        }
        
        // Boost score if multiple target columns are found
        const foundTargets = targetWords.filter(target => 
          columnNames.some(col => col.includes(target) || target.includes(col))
        )
        if (foundTargets.length > 1) {
          score += 0.1 * (foundTargets.length - 1)
          reasons.push(`Multiple target columns found (${foundTargets.length})`)
        }
        
        if (score > 0.3) {
          matches.push({
            fileId: file.file_id,
            fileName: file.name,
            sheetName: sheet.name,
            sheetIndex,
            relevanceScore: Math.min(1, score),
            matchReasons: reasons
          })
        }
      }
    }
    
    return matches.sort((a, b) => b.relevanceScore - a.relevanceScore)
  }
  
  /**
   * Tokenize text in a way that handles multiple languages better
   */
  private tokenizeMultilingual(text: string): string[] {
    // Split on common delimiters but preserve meaningful units
    return text
      .split(/[\s\-_,.()\[\]{}\/\\]+/)
      .filter(token => token.length > 0)
      .map(token => token.toLowerCase())
  }
  
  /**
   * Check if two sets of words have meaningful overlap
   */
  private hasWordOverlap(words1: string[], words2: string[]): boolean {
    for (const w1 of words1) {
      for (const w2 of words2) {
        // Exact match
        if (w1 === w2) return true
        
        // Substring match (for compound words)
        if (w1.length > 3 && w2.length > 3) {
          if (w1.includes(w2) || w2.includes(w1)) return true
        }
      }
    }
    return false
  }
  
  /**
   * Clear caches
   */
  clearCaches(): void {
    this.conceptCache.clear()
  }
}