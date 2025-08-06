import OpenAI from 'openai'
import { 
  ExtractionContext, 
  GeneratedExtraction,
  SheetStructure 
} from './sheet-structure-types'

export class LLMExtractionGenerator {
  private openai: OpenAI
  
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured')
    }
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }
  
  async generateExtractionCode(
    context: ExtractionContext,
    sampleData?: any[][]
  ): Promise<GeneratedExtraction> {
    const prompt = this.buildPrompt(context, sampleData)
    
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a data extraction expert. Analyze spreadsheet structure and data to understand which columns contain the requested information. Generate clean, simple JavaScript code that extracts exactly what the user needs.

CRITICAL: 
- Don't assume column names - work with what's actually there
- Analyze the data to understand what each column contains
- The code receives 'rows' and 'headers' parameters
- Always check array bounds before accessing`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 2000
      })
      
      const response = JSON.parse(completion.choices[0].message.content || '{}')
      
      return {
        code: response.code || this.getFallbackCode(),
        description: response.description || 'Extracts data based on query',
        expectedOutputFormat: response.expectedOutputFormat || 'Unknown',
        confidence: response.confidence || 0.5,
        warnings: response.warnings
      }
      
    } catch (error) {
      console.error('Error generating extraction code:', error)
      return {
        code: this.getFallbackCode(),
        description: 'Fallback extraction',
        expectedOutputFormat: 'Basic data',
        confidence: 0.3,
        warnings: ['Failed to generate optimal code']
      }
    }
  }
  
  private buildPrompt(context: ExtractionContext, sampleData?: any[][]): string {
    const { sheetStructure, query, intent } = context
    
    // Include sample data if available
    let sampleDataSection = ''
    if (sampleData && sampleData.length > 0) {
      const sampleRows = sampleData.slice(0, 5).map((row, idx) => {
        const rowData = sheetStructure.columns.map(col => {
          const value = row[col.index]
          return `${col.name}: ${value === null || value === undefined ? 'empty' : String(value).substring(0, 50)}`
        }).join(' | ')
        return `Row ${idx + 1}: ${rowData}`
      }).join('\n')
      
      sampleDataSection = `
SAMPLE DATA:
${sampleRows}
`
    }
    
    return `
User Query: "${query}"

ACTUAL SPREADSHEET STRUCTURE:
Columns:
${sheetStructure.columns.map(col => 
  `- Column ${col.index}: "${col.name}" (${col.dataType})`
).join('\n')}

${sampleDataSection}

TASK:
1. Analyze the actual column names and sample data
2. Determine which columns contain the information requested in the query
3. Generate JavaScript code to extract that data

For example, if the query is "sales by vendor" but the columns are "Order Information" and "Details":
- The vendor info might be in "Order Information" 
- Or it might be in "Details"
- Look at the sample data to understand the structure

The code should:
- Work with the actual column indices (0, 1, 2, etc.)
- Handle the real data structure
- Not assume specific column names exist
- Include clear comments explaining what data is being extracted

Return JSON:
{
  "code": "// Extract ${query}\\nconst result = [];\\n// Your code here\\nreturn result;",
  "description": "What the code does",
  "expectedOutputFormat": "What the output looks like",
  "confidence": 0.9,
  "warnings": []
}`
  }
  
  private getFallbackCode(): string {
    return `
// Basic extraction - returns all data
const result = [];
const dataStartRow = 1; // Skip header

for (let i = dataStartRow; i < rows.length; i++) {
  const row = rows[i];
  if (!Array.isArray(row) || row.length === 0) continue;
  
  const record = {};
  headers.forEach((header, idx) => {
    if (idx < row.length && row[idx] != null) {
      record[header] = row[idx];
    }
  });
  
  if (Object.keys(record).length > 0) {
    result.push(record);
  }
}

return result.slice(0, 100); // Limit results`
  }
}