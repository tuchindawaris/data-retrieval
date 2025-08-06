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
Analyze this spreadsheet search query: "${query}"

Determine:
1. Type: Is it looking up specific records (lookup), filtering data (filter), aggregating data (aggregate), or listing data (list)?
2. Target concepts: What data is the user looking for? (e.g., payments, sales, customers)
3. Key column: If there's a "by", "per", "for each" pattern, what column should data be grouped by?

Return JSON:
{
  "type": "lookup" | "filter" | "aggregate" | "list",
  "targetColumns": ["concept1", "concept2"],
  "keyColumn": "grouping column or null",
  "filters": [],
  "aggregations": []
}`

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a data analyst expert. Analyze queries to understand user intent.'
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
        type: response.type || 'list',
        targetColumns: response.targetColumns || [],
        keyColumn: response.keyColumn || null,
        filters: response.filters || [],
        aggregations: response.aggregations || []
      }
    } catch (error) {
      console.error('Error analyzing query intent:', error)
      return {
        type: 'list',
        targetColumns: [],
        filters: [],
        aggregations: []
      }
    }
  }
  
  async matchSheetsToQuery(
    query: string,
    files: FileMetadata[],
    intent: SearchIntent
  ): Promise<SheetMatch[]> {
    const spreadsheets = files.filter(f => 
      f.metadata?.isSpreadsheet && 
      f.metadata?.sheets && 
      f.metadata.sheets.length > 0
    )
    
    if (spreadsheets.length === 0) {
      return []
    }
    
    const schemaSummary = this.buildSchemaSummary(spreadsheets)
    
    const prompt = `
Query: "${query}"
Intent: ${JSON.stringify(intent)}

Analyze these spreadsheets and identify which sheets contain relevant data:

${schemaSummary}

For each relevant sheet, provide:
- fileId, fileName, sheetName, sheetIndex
- relevanceScore (0-1): How likely it contains the data
- matchReasons: Why it matches

Return JSON array of matches with relevanceScore > 0.5`

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Match user queries to spreadsheet schemas based on meaning, not literal text.'
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
      const matches = response.matches || []
      
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
      return []
    }
  }
  
  private buildSchemaSummary(spreadsheets: FileMetadata[]): string {
    const summaries: string[] = []
    
    for (const file of spreadsheets) {
      const sheets = file.metadata?.sheets || []
      
      for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
        const sheet = sheets[sheetIndex]
        const columns = sheet.columns?.filter((c: any) => c).slice(0, 20) || []
        
        const columnList = columns.map((c: any) => 
          `${c.name} (${c.dataType || 'unknown'})`
        ).join(', ')
        
        summaries.push(`
File: ${file.name} (ID: ${file.file_id})
Sheet: ${sheet.name} (Index: ${sheetIndex})
Columns: ${columnList}
Rows: ${sheet.totalRows || 0}
---`)
      }
    }
    
    return summaries.join('\n')
  }
}