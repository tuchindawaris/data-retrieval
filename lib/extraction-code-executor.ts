// lib/extraction-code-executor.ts

import { ExtractionResult, GeneratedExtraction } from './sheet-structure-types'

export class ExtractionCodeExecutor {
  private readonly MAX_RETRIES = 3
  private readonly EXECUTION_TIMEOUT = 5000 // 5 seconds
  
  /**
   * Execute extraction code with retry logic
   */
  async executeWithRetry(
    extraction: GeneratedExtraction,
    rows: any[][],
    headers: string[],
    onRetry?: (attempt: number, error: string) => Promise<GeneratedExtraction>
  ): Promise<ExtractionResult> {
    let lastError: string = ''
    let rowsProcessed = 0
    
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      const startTime = Date.now()
      
      try {
        console.log(`Execution attempt ${attempt}/${this.MAX_RETRIES}`)
        console.log(`Code to execute (first 500 chars): ${extraction.code.substring(0, 500)}...`)
        
        // Execute the extraction
        const data = await this.executeExtraction(
          attempt === 1 ? extraction : extraction,
          rows,
          headers
        )
        
        // Count rows processed (estimate based on result)
        if (Array.isArray(data)) {
          rowsProcessed = data.length
        } else if (typeof data === 'object' && data !== null) {
          rowsProcessed = Object.keys(data).length
        }
        
        return {
          success: true,
          data,
          executionTime: Date.now() - startTime,
          rowsProcessed
        }
        
      } catch (error: any) {
        lastError = error.message || String(error)
        console.error(`Execution attempt ${attempt} failed:`, lastError)
        
        // If we have retry callback and haven't exhausted retries
        if (onRetry && attempt < this.MAX_RETRIES) {
          console.log('Requesting code regeneration based on error...')
          try {
            // Get new extraction code based on error
            extraction = await onRetry(attempt, lastError)
            console.log('Received updated extraction code')
          } catch (retryError) {
            console.error('Failed to regenerate code:', retryError)
            // Continue with original code
          }
        }
      }
    }
    
    // All attempts failed
    return {
      success: false,
      error: `Extraction failed after ${this.MAX_RETRIES} attempts. Last error: ${lastError}`,
      executionTime: 0
    }
  }
  
  /**
   * Execute extraction code in a sandboxed environment
   */
  private async executeExtraction(
    extraction: GeneratedExtraction,
    rows: any[][],
    headers: string[]
  ): Promise<any> {
    // Validate code first
    this.validateCode(extraction.code)
    
    // Create execution context
    const contextCode = `
      // Utility functions available to extraction code
      function parseNumber(value) {
        if (typeof value === 'number') return value;
        if (!value) return 0;
        const str = String(value).replace(/[$,]/g, '');
        return parseFloat(str) || 0;
      }
      
      function parseDate(value) {
        if (!value) return null;
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
      }
      
      function isValidDate(value) {
        if (!value) return false;
        const date = new Date(value);
        return !isNaN(date.getTime());
      }
      
      function normalizeString(value) {
        return String(value || '').trim().toLowerCase();
      }
      
      // Fuzzy column matching helper
      function findColumnIndex(headers, keywords) {
        if (!Array.isArray(keywords)) keywords = [keywords];
        
        for (let i = 0; i < headers.length; i++) {
          const header = normalizeString(headers[i]);
          if (keywords.some(keyword => header.includes(keyword.toLowerCase()))) {
            return i;
          }
        }
        return -1;
      }
      
      // Find multiple columns matching keywords
      function findColumnIndices(headers, keywords) {
        if (!Array.isArray(keywords)) keywords = [keywords];
        const indices = [];
        
        for (let i = 0; i < headers.length; i++) {
          const header = normalizeString(headers[i]);
          if (keywords.some(keyword => header.includes(keyword.toLowerCase()))) {
            indices.push(i);
          }
        }
        return indices;
      }
      
      // Timeframe helpers
      function isLastQuarter(dateValue) {
        const date = parseDate(dateValue);
        if (!date) return false;
        
        const now = new Date();
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const currentYear = now.getFullYear();
        
        const lastQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
        const lastQuarterYear = currentQuarter === 0 ? currentYear - 1 : currentYear;
        
        const dateQuarter = Math.floor(date.getMonth() / 3);
        const dateYear = date.getFullYear();
        
        return dateQuarter === lastQuarter && dateYear === lastQuarterYear;
      }
      
      function isThisMonth(dateValue) {
        const date = parseDate(dateValue);
        if (!date) return false;
        
        const now = new Date();
        return date.getMonth() === now.getMonth() && 
               date.getFullYear() === now.getFullYear();
      }
      
      function isLastMonth(dateValue) {
        const date = parseDate(dateValue);
        if (!date) return false;
        
        const now = new Date();
        const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        
        return date.getMonth() === lastMonth && 
               date.getFullYear() === lastMonthYear;
      }
      
      // Common column name variations
      const columnVariations = {
        vendor: ['vendor', 'supplier', 'ผู้ขาย', 'ผู้จำหน่าย', 'company', 'บริษัท', 'provider', 'customer', 'ลูกค้า', 'client'],
        sales: ['sales', 'ยอดขาย', 'total sales', 'revenue', 'รายได้', 'amount'],
        amount: ['amount', 'total', 'จำนวน', 'เงิน', 'price', 'value', 'ยอด', 'มูลค่า'],
        payment: ['payment', 'การชำระ', 'paid', 'transaction', 'pay'],
        date: ['date', 'วันที่', 'datetime', 'time', 'เวลา', 'month', 'เดือน'],
        customer: ['customer', 'client', 'ลูกค้า', 'buyer'],
        product: ['product', 'สินค้า', 'item', 'รายการ', 'ผลิตภัณฑ์'],
        quantity: ['quantity', 'qty', 'จำนวน', 'ปริมาณ', 'amount']
      };
      
      // Array safety helper
      function safeArrayAccess(arr, index, defaultValue = null) {
        if (!Array.isArray(arr)) return defaultValue;
        if (index < 0 || index >= arr.length) return defaultValue;
        return arr[index];
      }
      
      // Check if row has data
      function isRowEmpty(row) {
        if (!Array.isArray(row)) return true;
        return !row.some(cell => cell !== null && cell !== undefined && cell !== '');
      }
      
      // Safe row length check
      function getRowLength(row) {
        return Array.isArray(row) ? row.length : 0;
      }
      
      // Main extraction code
      ${extraction.code}
    `
    
    // Create sandboxed function
    const extractFunction = new Function('rows', 'headers', contextCode)
    
    // Execute with timeout
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        reject(new Error(`Execution timeout after ${this.EXECUTION_TIMEOUT}ms`))
      }, this.EXECUTION_TIMEOUT)
      
      try {
        // Execute the function
        const result = extractFunction(rows, headers)
        clearTimeout(timeoutId)
        
        // Validate result
        this.validateResult(result)
        resolve(result)
        
      } catch (error: any) {
        clearTimeout(timeoutId)
        
        // Add more context to error messages
        let errorMessage = error.message || String(error)
        
        // Enhance error messages for common issues
        if (errorMessage.includes('Cannot read properties of undefined')) {
          errorMessage += ' (This usually means trying to access .length or an index on undefined/null)'
        }
        
        reject(new Error(`Execution error: ${errorMessage}`))
      }
    })
  }
  
  /**
   * Validate generated code for safety
   */
  private validateCode(code: string): void {
    // Check for dangerous patterns
    const dangerousPatterns = [
      { pattern: /eval\s*\(/, name: 'eval()' },
      { pattern: /new\s+Function\s*\(/, name: 'new Function()' },
      { pattern: /require\s*\(/, name: 'require()' },
      { pattern: /import\s+/, name: 'import' },
      { pattern: /process\./g, name: 'process' },
      { pattern: /global\./g, name: 'global' },
      { pattern: /window\./g, name: 'window' },
      { pattern: /document\./g, name: 'document' },
      { pattern: /__proto__/, name: '__proto__' },
      { pattern: /constructor\s*\[/, name: 'constructor[]' },
      { pattern: /setTimeout|setInterval/, name: 'timer functions' },
      { pattern: /fetch|XMLHttpRequest/, name: 'network calls' }
    ]
    
    for (const { pattern, name } of dangerousPatterns) {
      if (pattern.test(code)) {
        throw new Error(`Code contains unsafe pattern: ${name}`)
      }
    }
    
    // Ensure code has a return statement
    if (!code.includes('return')) {
      throw new Error('Extraction code must return a value')
    }
    
    // Check for infinite loops (basic detection)
    const loopPattern = /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/
    if (loopPattern.test(code)) {
      throw new Error('Code contains potential infinite loop')
    }
  }
  
  /**
   * Validate extraction result
   */
  private validateResult(result: any): void {
    // Check if result is serializable
    try {
      JSON.stringify(result)
    } catch (error) {
      throw new Error('Extraction result is not JSON serializable')
    }
    
    // Check size limits (prevent memory issues)
    const jsonSize = JSON.stringify(result).length
    const maxSize = 10 * 1024 * 1024 // 10MB limit
    
    if (jsonSize > maxSize) {
      throw new Error(`Result too large: ${(jsonSize / 1024 / 1024).toFixed(2)}MB exceeds 10MB limit`)
    }
    
    // Warn if result seems empty
    if (result === null || result === undefined) {
      throw new Error('Extraction returned null or undefined')
    }
    
    if (Array.isArray(result) && result.length === 0) {
      console.warn('Extraction returned empty array - no matching data found')
    }
    
    if (typeof result === 'object' && Object.keys(result).length === 0) {
      console.warn('Extraction returned empty object - no matching data found')
    }
  }
}