import { ExtractionResult, GeneratedExtraction } from './sheet-structure-types'

export class ExtractionCodeExecutor {
  private readonly MAX_RETRIES = 3
  private readonly EXECUTION_TIMEOUT = 5000
  
  async executeWithRetry(
    extraction: GeneratedExtraction,
    rows: any[][],
    headers: string[],
    onRetry?: (attempt: number, error: string) => Promise<GeneratedExtraction>
  ): Promise<ExtractionResult> {
    let lastError: string = ''
    
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      const startTime = Date.now()
      
      try {
        const data = await this.executeExtraction(
          extraction,
          rows,
          headers
        )
        
        const rowsProcessed = Array.isArray(data) ? data.length : 
                            (typeof data === 'object' && data !== null) ? Object.keys(data).length : 0
        
        return {
          success: true,
          data,
          executionTime: Date.now() - startTime,
          rowsProcessed
        }
        
      } catch (error: any) {
        lastError = error.message || String(error)
        console.error(`Attempt ${attempt} failed:`, lastError)
        
        if (onRetry && attempt < this.MAX_RETRIES) {
          try {
            extraction = await onRetry(attempt, lastError)
          } catch (retryError) {
            console.error('Failed to regenerate code:', retryError)
          }
        }
      }
    }
    
    return {
      success: false,
      error: `Failed after ${this.MAX_RETRIES} attempts. Last error: ${lastError}`,
      executionTime: 0
    }
  }
  
  private async executeExtraction(
    extraction: GeneratedExtraction,
    rows: any[][],
    headers: string[]
  ): Promise<any> {
    // Validate code
    if (!extraction.code.includes('return')) {
      throw new Error('Code must return a value')
    }
    
    // Create safe execution context
    const contextCode = `
      // Helper functions
      function parseNumber(value) {
        if (typeof value === 'number') return value;
        if (!value) return 0;
        const str = String(value).replace(/[$,]/g, '');
        return parseFloat(str) || 0;
      }
      
      function normalizeString(value) {
        return String(value || '').trim().toLowerCase();
      }
      
      function isRowEmpty(row) {
        if (!Array.isArray(row)) return true;
        return !row.some(cell => cell !== null && cell !== undefined && cell !== '');
      }
      
      ${extraction.code}
    `
    
    const extractFunction = new Function('rows', 'headers', contextCode)
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Execution timeout after ${this.EXECUTION_TIMEOUT}ms`))
      }, this.EXECUTION_TIMEOUT)
      
      try {
        const result = extractFunction(rows, headers)
        clearTimeout(timeoutId)
        
        // Validate result
        try {
          JSON.stringify(result)
        } catch {
          throw new Error('Result is not JSON serializable')
        }
        
        resolve(result)
      } catch (error: any) {
        clearTimeout(timeoutId)
        reject(new Error(`Execution error: ${error.message}`))
      }
    })
  }
}