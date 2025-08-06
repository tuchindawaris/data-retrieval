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
  
  /**
   * Generate extraction code based on structure and query
   */
  async generateExtractionCode(
    context: ExtractionContext
  ): Promise<GeneratedExtraction> {
    const prompt = this.buildPrompt(context)
    
    try {
      console.log('Generating extraction code for query:', context.query)
      
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Low temperature for consistency
        response_format: { type: 'json_object' },
        max_tokens: 2000
      })
      
      const response = JSON.parse(completion.choices[0].message.content || '{}')
      
      return {
        code: response.code || this.generateFallbackCode(context),
        description: response.description || 'Extracts data based on query',
        expectedOutputFormat: response.expectedOutputFormat || 'Unknown format',
        confidence: response.confidence || 0.5,
        warnings: response.warnings
      }
      
    } catch (error) {
      console.error('Error generating extraction code:', error)
      // Return fallback extraction
      return {
        code: this.generateFallbackCode(context),
        description: 'Fallback extraction due to generation error',
        expectedOutputFormat: 'Basic filtered data',
        confidence: 0.3,
        warnings: ['Failed to generate optimal extraction code, using fallback']
      }
    }
  }
  
  /**
   * Build comprehensive prompt for code generation
   */
  private buildPrompt(context: ExtractionContext): string {
    const { sheetStructure, query, intent } = context
    
    return `
Generate JavaScript code to extract data from a spreadsheet based on this query:
"${query}"

SHEET STRUCTURE:
Sheet Name: ${sheetStructure.sheetName}
Dimensions: ${sheetStructure.dimensions.rows} rows × ${sheetStructure.dimensions.cols} columns

COLUMNS:
${sheetStructure.columns.map(col => 
  `- Column ${col.letter} (index ${col.index}): "${col.name}"
    Type: ${col.dataType}${col.hasFormula ? ' (has formulas)' : ''}
    Data density: ${(col.density * 100).toFixed(0)}%
    Unique values: ${col.uniqueValueCount || 'unknown'}
    ${col.samplePatterns?.length ? `Patterns: ${col.samplePatterns.join(', ')}` : ''}`
).join('\n')}

TABLE INFORMATION:
${sheetStructure.tables.map(table => 
  `- Table "${table.id}":
    Location: Rows ${table.bounds.startRow}-${table.bounds.endRow}, Columns ${table.bounds.startCol}-${table.bounds.endCol}
    Headers: ${table.hasHeaders ? `Yes (${table.headerRows} rows)` : 'No'}
    Data starts at row: ${table.bounds.startRow + table.headerRows}`
).join('\n')}

DATA PATTERNS:
- Empty columns: ${sheetStructure.patterns.emptyColumns.length ? sheetStructure.patterns.emptyColumns.join(', ') : 'none'}
- Sparse columns (<30% filled): ${sheetStructure.patterns.sparseColumns.map(c => `${c.index} (${(c.density * 100).toFixed(0)}%)`).join(', ') || 'none'}
- Formula columns: ${sheetStructure.patterns.formulaColumns.join(', ') || 'none'}
- Has merged cells: ${sheetStructure.metadata.hasMergedCells ? 'Yes' : 'No'}

QUERY INTENT:
- Type: ${intent.type}
- Target columns: ${intent.targetColumns.join(', ')}
${intent.keyColumn ? `- Key column for grouping: ${intent.keyColumn}` : ''}
${intent.filters?.length ? `- Filters: ${JSON.stringify(intent.filters)}` : ''}
${intent.aggregations?.length ? `- Aggregations: ${intent.aggregations.join(', ')}` : ''}
${intent.timeframe ? `- Timeframe: ${intent.timeframe}` : ''}

CRITICAL REQUIREMENTS FOR YOUR CODE:
1. ALWAYS initialize variables before use (e.g., const result = {})
2. ALWAYS check if arrays/objects exist before accessing properties
3. The code receives two parameters: 'rows' (array of arrays) and 'headers' (array of strings)
4. NEVER access .length property without checking if the variable exists first
5. For column matching:
   - Use fuzzy matching, not exact matching
   - Check if column name INCLUDES the target keyword (case-insensitive)
   - For "vendor", also check for "supplier", "ผู้ขาย", "customer", "ลูกค้า", "company", "บริษัท", etc.
   - For "sales", also check for "ยอดขาย", "total", "amount", "revenue", etc.
   - For "amount", also check for "total", "จำนวน", "เงิน", "price", "value", etc.
   - For "payment", also check for "การชำระ", "paid", "transaction", etc.
6. ALWAYS validate column indices before using them:
   - Check if index >= 0
   - Check if index < headers.length
   - Check if row[index] exists before accessing
7. NEVER do row.length without checking if row exists and is an array
8. Handle the actual data structure (tables might not start at row 0)
9. Skip empty rows (check if all cells are empty/null/undefined)
10. Return a JSON-serializable result
11. Include detailed error messages that specify what's missing

CRITICAL: When you need to check array length, ALWAYS do:
if (Array.isArray(someArray) && someArray.length > 0) { ... }
NEVER just do someArray.length without the Array.isArray check!

EXAMPLE COLUMN MATCHING CODE:
// CRITICAL: Always check if arrays exist and have length before accessing
if (!Array.isArray(headers) || headers.length === 0) {
  throw new Error('Headers array is empty or invalid');
}

// Find vendor/customer column (fuzzy match)
let vendorColIndex = -1;
// NOTE: In sales contexts, vendor often means customer!
const vendorKeywords = ['vendor', 'supplier', 'ผู้ขาย', 'ผู้จำหน่าย', 'company', 'บริษัท', 'customer', 'ลูกค้า', 'client'];
for (let i = 0; i < headers.length; i++) {
  const header = (headers[i] || '').toLowerCase();
  if (vendorKeywords.some(keyword => header.includes(keyword))) {
    vendorColIndex = i;
    break;
  }
}

if (vendorColIndex === -1) {
  throw new Error('Vendor/Customer column not found. Available columns: ' + headers.join(', '));
}

// When processing rows, ALWAYS check array validity
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  // CRITICAL: Check if row exists and is array before accessing length
  if (!row || !Array.isArray(row) || row.length === 0) continue;
  
  // CRITICAL: Check column index is within bounds
  if (vendorColIndex >= row.length) continue;
  
  const value = row[vendorColIndex];
  // ... rest of processing
}

EXAMPLE OF SAFE ARRAY HANDLING:
// BAD - This will cause "Cannot read properties of undefined (reading 'length')"
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  if (row.length > 0) { // ERROR if row is undefined!
    // process
  }
}

// GOOD - Always check array validity first
if (!Array.isArray(rows)) {
  throw new Error('Rows is not an array');
}

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  if (!Array.isArray(row)) continue; // Skip non-array rows
  if (row.length === 0) continue; // Now safe to check length
  
  // process row safely
}

IMPORTANT CONSTRAINTS:
- Do NOT use any external libraries or imports
- Do NOT access global variables except rows and headers
- ALWAYS initialize all variables (const result = {}, not just result = {})
- ALWAYS check array bounds before accessing elements
- ALWAYS check if something is an array before accessing .length
- Must return a value

CONTEXT UNDERSTANDING:
- In SALES spreadsheets: "vendor" usually means the customer/buyer (ลูกค้า)
- In PURCHASE spreadsheets: "vendor" means the supplier (ผู้ขาย)
- When the query asks for "sales by vendor" and the sheet has "customer" columns, use the customer column as the grouping key
- Common sales columns: ยอดขาย (Total Sales), ลูกค้า (Customer), รายได้ (Revenue)
- Common purchase columns: การชำระเงิน (Payment), ผู้ขาย (Vendor/Supplier)

OUTPUT FORMAT:
Return a JSON object with:
{
  "code": "// Your extraction code here\\nconst result = {};\\n// ... more code ...\\nreturn result;",
  "description": "Brief description of what the code does",
  "expectedOutputFormat": "Description of the output data structure",
  "confidence": 0.9, // 0-1 confidence in the solution
  "warnings": [] // Any warnings about data quality or assumptions
}

Remember: The table data starts at row ${sheetStructure.tables[0]?.bounds.startRow + sheetStructure.tables[0]?.headerRows || 0}, not row 0!`
  }
  
  /**
   * System prompt for consistent behavior
   */
  private getSystemPrompt(): string {
    return `You are an expert data engineer specializing in spreadsheet data extraction. 
You write clean, efficient JavaScript code that extracts exactly what users need from complex spreadsheets.

CRITICAL RULES:
1. ALWAYS use fuzzy column matching - never assume exact column names
2. ALWAYS initialize variables before use (const result = {}, not just result)
3. ALWAYS check array bounds and object properties before accessing
4. ALWAYS provide detailed error messages that help debugging
5. NEVER use exact string matching for columns - use .includes() for flexibility
6. NEVER access .length without checking if the variable is an array first

CRITICAL ARRAY SAFETY:
- Before ANY array.length check: if (!Array.isArray(array)) continue;
- Before ANY row[index] access: if (index >= row.length) continue;
- Before ANY for loop on arrays: if (!Array.isArray(array)) return result;
- Use this pattern: if (Array.isArray(row) && row.length > 0) { ... }

You understand various data layouts, handle edge cases, and always consider that:
- Column names might be in different languages (Thai, English, etc.)
- Similar concepts have many variations (vendor = supplier = ผู้ขาย = customer in sales context)
- Data might have unexpected formats or locations
- Arrays might be undefined, null, or have unexpected lengths

Your code is well-commented and handles errors gracefully.
You pay careful attention to data types and conversions.
You NEVER expose actual data values in your responses, only structure and logic.`
  }
  
  /**
   * Generate fallback code for basic extraction
   */
  private generateFallbackCode(context: ExtractionContext): string {
    const { sheetStructure, intent } = context
    const mainTable = sheetStructure.tables[0]
    const dataStartRow = mainTable ? mainTable.bounds.startRow + mainTable.headerRows : 1
    
    if (intent.type === 'aggregate' && intent.keyColumn) {
      // Group by key column and aggregate
      return `
// Fallback aggregation code with fuzzy column matching
const results = {};

// Find key column using fuzzy matching
let keyColIndex = -1;
const keyKeywords = ['${intent.keyColumn.toLowerCase()}', 'vendor', 'supplier', 'ผู้ขาย', 'ผู้จำหน่าย', 'company', 'บริษัท', 'customer', 'ลูกค้า', 'client'];
for (let i = 0; i < headers.length; i++) {
  const header = (headers[i] || '').toLowerCase();
  if (keyKeywords.some(keyword => header.includes(keyword))) {
    keyColIndex = i;
    break;
  }
}

// Find value columns for aggregation
const valueColIndices = [];
const valueKeywords = ['amount', 'total', 'จำนวน', 'เงิน', 'price', 'value', 'payment', 'การชำระ', 'sales', 'ยอดขาย', 'revenue'];
for (let i = 0; i < headers.length; i++) {
  const header = (headers[i] || '').toLowerCase();
  if (valueKeywords.some(keyword => header.includes(keyword))) {
    valueColIndices.push(i);
  }
}

if (keyColIndex === -1) {
  throw new Error('Key column not found. Available columns: ' + headers.join(', '));
}

if (valueColIndices.length === 0) {
  throw new Error('No value columns found for aggregation. Available columns: ' + headers.join(', '));
}

const dataStartRow = ${dataStartRow};

for (let i = dataStartRow; i < rows.length; i++) {
  const row = rows[i];
  if (!row || !Array.isArray(row)) continue;
  
  // Skip empty rows - check length safely
  if (!Array.isArray(row) || row.length === 0) continue;
  
  const hasData = row.some(cell => cell !== null && cell !== undefined && cell !== '');
  if (!hasData) continue;
  
  // Check if keyColIndex is valid for this row
  if (keyColIndex >= row.length) continue;
  
  const key = row[keyColIndex];
  if (!key || key === '') continue;
  
  const keyStr = String(key).trim();
  if (!results[keyStr]) {
    results[keyStr] = { count: 0, total: 0 };
  }
  
  results[keyStr].count++;
  
  // Sum all value columns
  valueColIndices.forEach(colIdx => {
    if (colIdx >= 0 && colIdx < row.length) {
      const value = parseFloat(String(row[colIdx] || 0).replace(/[$,]/g, ''));
      if (!isNaN(value)) {
        results[keyStr].total += value;
      }
    }
  });
}

return results;`
    } else if (intent.type === 'filter') {
      // Filter based on conditions
      return `
// Fallback filter code with fuzzy matching
const results = [];

// Find target columns using fuzzy matching
const targetColIndices = [];
const targetKeywords = ${JSON.stringify(intent.targetColumns)};

headers.forEach((header, idx) => {
  const headerLower = (header || '').toLowerCase();
  if (targetKeywords.some(keyword => headerLower.includes(keyword.toLowerCase()))) {
    targetColIndices.push(idx);
  }
});

if (targetColIndices.length === 0) {
  // If no columns match, include all non-empty columns
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] && headers[i].trim() !== '') {
      targetColIndices.push(i);
    }
  }
}

const dataStartRow = ${dataStartRow};

for (let i = dataStartRow; i < rows.length; i++) {
  const row = rows[i];
  if (!row || !Array.isArray(row)) continue;
  
  // Skip empty rows
  const hasData = row.some(cell => cell !== null && cell !== undefined && cell !== '');
  if (!hasData) continue;
  
  // Extract only relevant columns
  const extracted = {};
  let hasTargetData = false;
  
  targetColIndices.forEach(idx => {
    if (idx >= 0 && idx < row.length && idx < headers.length) {
      const value = row[idx];
      if (value !== null && value !== undefined && value !== '') {
        extracted[headers[idx]] = value;
        hasTargetData = true;
      }
    }
  });
  
  if (hasTargetData) {
    results.push(extracted);
  }
  
  // Limit results to prevent memory issues
  if (results.length >= 1000) break;
}

return results;`
    } else {
      // Basic list extraction
      return `
// Fallback list extraction
const results = [];
const dataStartRow = ${dataStartRow};
const maxRows = 100;

for (let i = dataStartRow; i < Math.min(rows.length, dataStartRow + maxRows); i++) {
  const row = rows[i];
  if (!row || !Array.isArray(row)) continue;
  
  // Skip empty rows
  const hasData = row.some(cell => cell !== null && cell !== undefined && cell !== '');
  if (!hasData) continue;
  
  const record = {};
  headers.forEach((header, idx) => {
    if (idx < row.length && row[idx] !== null && row[idx] !== undefined && row[idx] !== '') {
      record[header] = row[idx];
    }
  });
  
  if (Object.keys(record).length > 0) {
    results.push(record);
  }
}

return results;`
    }
  }
}