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
  
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured')
    }
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }
  
  async analyzeQueryIntent(query: string): Promise<SearchIntent> {
    const prompt = `
Analyze this spreadsheet search query and determine the user's intent:
Query: "${query}"

Determine:
1. Search type (lookup specific values, filter data, aggregate/sum, or list all)
2. Target columns the user is looking for
3. Any filters implied in the query
4. Any aggregations needed

Examples:
- "payments by vendor name" → lookup type, target: vendor/supplier columns
- "total sales last month" → aggregate type, target: sales/amount columns, filter: date
- "all invoices over $1000" → filter type, target: invoice/amount columns, filter: >1000

Return JSON format:
{
  "type": "lookup" | "filter" | "aggregate" | "list",
  "targetColumns": ["vendor", "supplier", "vendor_name"],
  "filters": [{"column": "date", "operator": "between", "value": ["2024-01-01", "2024-01-31"]}],
  "aggregations": ["sum"]
}
`

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a data analyst expert at understanding spreadsheet queries. Always return valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: 500
      })
      
      const response = JSON.parse(completion.choices[0].message.content || '{}')
      
      return {
        type: response.type || 'lookup',
        targetColumns: response.targetColumns || [],
        filters: response.filters || [],
        aggregations: response.aggregations || []
      }
    } catch (error) {
      console.error('Error analyzing query intent:', error)
      // Fallback to basic keyword analysis
      return this.fallbackIntentAnalysis(query)
    }
  }
  
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

Analyze these spreadsheet schemas and identify which sheets likely contain relevant data:

${schemaSummary}

For each relevant sheet, provide:
1. Relevance score (0-1)
2. Reasons why it matches
3. Which columns are most relevant

Return JSON array of matches:
[{
  "fileId": "xxx",
  "fileName": "xxx", 
  "sheetName": "xxx",
  "sheetIndex": 0,
  "relevanceScore": 0.95,
  "matchReasons": ["Contains vendor column", "Has payment data"],
  "relevantColumns": ["Vendor Name", "Payment Amount"]
}]

Only include sheets with relevance score > 0.5
`

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a data analyst expert at matching queries to spreadsheet schemas. Be accurate and only match truly relevant sheets.'
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
      // Fallback to keyword matching
      return this.fallbackSheetMatching(query, spreadsheets, intent)
    }
  }
  
  private buildSchemaSummary(spreadsheets: FileMetadata[]): string {
    const summaries: string[] = []
    
    for (const file of spreadsheets) {
      const sheets = file.metadata?.sheets || []
      
      for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
        const sheet = sheets[sheetIndex]
        const columns = sheet.columns?.filter((c: any) => c).slice(0, 20) || []
        
        summaries.push(`
File ID: ${file.file_id}
File Name: ${file.name}
Sheet Name: ${sheet.name}
Sheet Index: ${sheetIndex}
Total Rows: ${sheet.totalRows || 0}
Columns: ${columns.map((c: any) => `${c.name} (${c.dataType})`).join(', ')}
${file.metadata?.summary ? `Summary: ${file.metadata.summary}` : ''}
---`)
      }
    }
    
    return summaries.join('\n')
  }
  
  private fallbackIntentAnalysis(query: string): SearchIntent {
    const lowerQuery = query.toLowerCase()
    
    // Detect aggregation keywords
    const aggregationKeywords = ['total', 'sum', 'count', 'average', 'avg', 'min', 'max']
    const hasAggregation = aggregationKeywords.some(k => lowerQuery.includes(k))
    
    // Detect filter keywords
    const filterKeywords = ['over', 'under', 'greater', 'less', 'between', 'last', 'this']
    const hasFilter = filterKeywords.some(k => lowerQuery.includes(k))
    
    // Detect lookup keywords
    const lookupKeywords = ['by', 'for', 'find', 'search', 'lookup', 'get']
    const hasLookup = lookupKeywords.some(k => lowerQuery.includes(k))
    
    // Extract potential column names (simple heuristic)
    const commonColumns = [
      'vendor', 'supplier', 'customer', 'client', 'payment', 'amount',
      'invoice', 'date', 'name', 'email', 'phone', 'address', 'total',
      'price', 'cost', 'quantity', 'product', 'service', 'description'
    ]
    
    const targetColumns = commonColumns.filter(col => 
      lowerQuery.includes(col) || 
      lowerQuery.includes(col + 's') || 
      lowerQuery.includes(col.replace('_', ' '))
    )
    
    let type: SearchIntent['type'] = 'list'
    if (hasAggregation) type = 'aggregate'
    else if (hasFilter) type = 'filter'
    else if (hasLookup) type = 'lookup'
    
    return {
      type,
      targetColumns,
      filters: [],
      aggregations: hasAggregation ? ['sum'] : []
    }
  }
  
  private fallbackSheetMatching(
    query: string,
    spreadsheets: FileMetadata[],
    intent: SearchIntent
  ): SheetMatch[] {
    const lowerQuery = query.toLowerCase()
    const targetWords = intent.targetColumns.map(c => c.toLowerCase())
    const queryWords = lowerQuery.split(/\s+/)
    
    const matches: SheetMatch[] = []
    
    for (const file of spreadsheets) {
      const sheets = file.metadata?.sheets || []
      
      for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
        const sheet = sheets[sheetIndex]
        const columns = sheet.columns?.filter((c: any) => c) || []
        
        let score = 0
        const reasons: string[] = []
        
        // Check sheet name
        if (sheet.name && queryWords.some(w => sheet.name.toLowerCase().includes(w))) {
          score += 0.3
          reasons.push('Sheet name matches query')
        }
        
        // Check column names
        const columnNames = columns.map((c: any) => c.name?.toLowerCase() || '')
        for (const target of targetWords) {
          if (columnNames.some(cn => cn.includes(target))) {
            score += 0.4
            reasons.push(`Contains ${target} column`)
            break
          }
        }
        
        // Check file name
        if (queryWords.some(w => file.name.toLowerCase().includes(w))) {
          score += 0.2
          reasons.push('File name matches query')
        }
        
        // Check summary
        if (file.metadata?.summary && 
            queryWords.some(w => file.metadata.summary.toLowerCase().includes(w))) {
          score += 0.1
          reasons.push('Summary mentions query terms')
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
}