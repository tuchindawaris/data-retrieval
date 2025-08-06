// lib/sheet-structure-analyzer.ts

import * as XLSX from 'xlsx'
import { 
  SheetStructure, 
  ColumnStructure, 
  TableStructure, 
  DataPatterns 
} from './sheet-structure-types'

export class SheetStructureAnalyzer {
  
  /**
   * Analyze sheet structure without exposing actual data values
   */
  analyzeStructure(
    worksheet: XLSX.WorkSheet,
    sheetName: string
  ): SheetStructure {
    // Get sheet range
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1')
    const dimensions = {
      rows: range.e.r + 1,
      cols: range.e.c + 1
    }
    
    // Convert to array for analysis
    const data = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      raw: false,
      defval: null
    }) as any[][]
    
    // Detect tables and data boundaries
    const tables = this.detectTables(data, dimensions)
    const mainTable = tables[0] || this.createDefaultTable(dimensions)
    
    // Analyze columns
    const columns = this.analyzeColumns(data, mainTable)
    
    // Detect patterns
    const patterns = this.detectPatterns(data, worksheet, columns)
    
    // Metadata
    const metadata = {
      hasFormulas: this.hasFormulas(worksheet),
      hasMergedCells: !!worksheet['!merges'] && worksheet['!merges'].length > 0,
      hasMultipleHeaders: this.detectMultipleHeaders(data, mainTable),
      dataStartRow: mainTable.bounds.startRow
    }
    
    return {
      sheetName,
      dimensions,
      columns,
      tables,
      patterns,
      metadata
    }
  }
  
  /**
   * Detect tables within the sheet (handling non-standard layouts)
   */
  private detectTables(data: any[][], dimensions: { rows: number; cols: number }): TableStructure[] {
    const tables: TableStructure[] = []
    
    // Find regions of contiguous data
    let currentTable: TableStructure | null = null
    let emptyRowCount = 0
    
    for (let r = 0; r < data.length; r++) {
      const row = data[r] || []
      const nonEmptyCells = row.filter(cell => cell !== null && cell !== undefined && cell !== '').length
      
      if (nonEmptyCells > 0) {
        if (!currentTable) {
          // Start new table
          const firstDataCol = row.findIndex(cell => cell !== null && cell !== undefined && cell !== '')
          const lastDataCol = row.reduce((last, cell, idx) => 
            (cell !== null && cell !== undefined && cell !== '') ? idx : last, firstDataCol)
          
          currentTable = {
            id: `table_${tables.length + 1}`,
            bounds: {
              startRow: r,
              endRow: r,
              startCol: firstDataCol,
              endCol: lastDataCol
            },
            hasHeaders: this.rowLooksLikeHeader(row),
            headerRows: 1
          }
        } else {
          // Extend current table
          currentTable.bounds.endRow = r
          
          // Update column bounds
          const firstDataCol = row.findIndex(cell => cell !== null && cell !== undefined && cell !== '')
          const lastDataCol = row.reduce((last, cell, idx) => 
            (cell !== null && cell !== undefined && cell !== '') ? idx : last, firstDataCol)
          
          if (firstDataCol >= 0) {
            currentTable.bounds.startCol = Math.min(currentTable.bounds.startCol, firstDataCol)
            currentTable.bounds.endCol = Math.max(currentTable.bounds.endCol, lastDataCol)
          }
        }
        emptyRowCount = 0
      } else {
        emptyRowCount++
        
        // If we see 3+ empty rows, consider the table ended
        if (currentTable && emptyRowCount >= 3) {
          tables.push(currentTable)
          currentTable = null
        }
      }
    }
    
    // Add final table if exists
    if (currentTable) {
      tables.push(currentTable)
    }
    
    // If no tables detected, assume whole sheet is one table
    if (tables.length === 0) {
      tables.push(this.createDefaultTable(dimensions))
    }
    
    return tables
  }
  
  /**
   * Analyze columns without exposing data
   */
  private analyzeColumns(data: any[][], table: TableStructure): ColumnStructure[] {
    const columns: ColumnStructure[] = []
    
    // Get headers from the table's first row
    const headerRow = data[table.bounds.startRow] || []
    
    for (let c = table.bounds.startCol; c <= table.bounds.endCol; c++) {
      const header = headerRow[c] || `Column ${c + 1}`
      const columnData: any[] = []
      
      // Collect column data (excluding header rows)
      for (let r = table.bounds.startRow + table.headerRows; r <= table.bounds.endRow; r++) {
        if (data[r] && data[r][c] !== undefined) {
          columnData.push(data[r][c])
        }
      }
      
      const column: ColumnStructure = {
        index: c,
        name: String(header).trim(),
        letter: this.getColumnLetter(c),
        dataType: this.inferDataType(columnData),
        density: this.calculateDensity(columnData),
        uniqueValueCount: this.countUniqueValues(columnData),
        hasFormula: false, // Will be updated later
        samplePatterns: this.detectValuePatterns(columnData)
      }
      
      columns.push(column)
    }
    
    return columns
  }
  
  /**
   * Detect patterns in the data structure
   */
  private detectPatterns(
    data: any[][], 
    worksheet: XLSX.WorkSheet,
    columns: ColumnStructure[]
  ): DataPatterns {
    const patterns: DataPatterns = {
      emptyColumns: [],
      sparseColumns: [],
      formulaColumns: [],
      mergedCellRegions: []
    }
    
    // Find empty and sparse columns
    columns.forEach(col => {
      if (col.density === 0) {
        patterns.emptyColumns.push(col.index)
      } else if (col.density < 0.3) {
        patterns.sparseColumns.push({
          index: col.index,
          density: col.density
        })
      }
    })
    
    // Detect formula columns
    for (let c = 0; c < columns.length; c++) {
      const colLetter = columns[c].letter
      let hasFormula = false
      
      // Check a few cells in this column for formulas
      for (let r = 1; r <= Math.min(10, data.length); r++) {
        const cellAddr = `${colLetter}${r}`
        const cell = worksheet[cellAddr]
        if (cell && cell.f) {
          hasFormula = true
          break
        }
      }
      
      if (hasFormula) {
        patterns.formulaColumns.push(c)
        columns[c].hasFormula = true
      }
    }
    
    // Get merged cell regions
    if (worksheet['!merges']) {
      patterns.mergedCellRegions = worksheet['!merges'].map(merge => ({
        startRow: merge.s.r,
        endRow: merge.e.r,
        startCol: merge.s.c,
        endCol: merge.e.c
      }))
    }
    
    return patterns
  }
  
  /**
   * Infer data type from column values without exposing the values
   */
  private inferDataType(values: any[]): ColumnStructure['dataType'] {
    if (values.length === 0) return 'empty'
    
    const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '')
    if (nonEmpty.length === 0) return 'empty'
    
    const types = {
      number: 0,
      currency: 0,
      percentage: 0,
      date: 0,
      boolean: 0,
      string: 0
    }
    
    nonEmpty.forEach(value => {
      const strValue = String(value)
      
      // Check for currency
      if (strValue.match(/^[$£€¥]\s*[\d,]+\.?\d*$/) || strValue.match(/^[\d,]+\.?\d*\s*[$£€¥]$/)) {
        types.currency++
      }
      // Check for percentage
      else if (strValue.match(/^[\d.]+%$/) || strValue.match(/^%[\d.]+$/)) {
        types.percentage++
      }
      // Check for date
      else if (strValue.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/) || 
               strValue.match(/^\d{4}-\d{2}-\d{2}/) ||
               strValue.match(/^\d{1,2}-\w{3}-\d{2,4}$/)) {
        types.date++
      }
      // Check for boolean
      else if (strValue.toLowerCase() === 'true' || strValue.toLowerCase() === 'false' ||
               strValue === '1' || strValue === '0' ||
               strValue.toLowerCase() === 'yes' || strValue.toLowerCase() === 'no') {
        types.boolean++
      }
      // Check for number
      else if (!isNaN(parseFloat(strValue.replace(/,/g, '')))) {
        types.number++
      }
      // Default to string
      else {
        types.string++
      }
    })
    
    // Determine primary type (>70% threshold)
    const total = nonEmpty.length
    if (types.currency / total > 0.7) return 'currency'
    if (types.percentage / total > 0.7) return 'percentage'
    if (types.date / total > 0.7) return 'date'
    if (types.boolean / total > 0.7) return 'boolean'
    if (types.number / total > 0.7) return 'number'
    if (types.string / total > 0.7) return 'string'
    
    return 'mixed'
  }
  
  /**
   * Calculate column density (percentage of non-empty cells)
   */
  private calculateDensity(values: any[]): number {
    if (values.length === 0) return 0
    const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '').length
    return Math.round((nonEmpty / values.length) * 100) / 100
  }
  
  /**
   * Count unique values (capped for performance)
   */
  private countUniqueValues(values: any[]): number {
    const unique = new Set(
      values
        .filter(v => v !== null && v !== undefined && v !== '')
        .slice(0, 1000) // Cap at 1000 for performance
    )
    return unique.size
  }
  
  /**
   * Detect common patterns in values without exposing them
   */
  private detectValuePatterns(values: any[]): string[] {
    const patterns: string[] = []
    const sampleSize = Math.min(20, values.length)
    const samples = values.filter(v => v !== null && v !== undefined && v !== '').slice(0, sampleSize)
    
    if (samples.length === 0) return patterns
    
    // Check for common patterns
    const patternChecks = [
      { pattern: 'email', regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      { pattern: 'phone', regex: /^[\+\d\s\-\(\)]+$/ },
      { pattern: 'id', regex: /^[A-Z0-9\-]+$/ },
      { pattern: 'url', regex: /^https?:\/\// },
      { pattern: 'alphanumeric_id', regex: /^[A-Z]{2,}\d{3,}$/ }
    ]
    
    patternChecks.forEach(check => {
      const matches = samples.filter(s => check.regex.test(String(s))).length
      if (matches / samples.length > 0.5) {
        patterns.push(check.pattern)
      }
    })
    
    return patterns
  }
  
  /**
   * Check if row looks like a header
   */
  private rowLooksLikeHeader(row: any[]): boolean {
    const nonEmpty = row.filter(cell => cell !== null && cell !== undefined && cell !== '')
    if (nonEmpty.length === 0) return false
    
    // Headers are usually strings and don't contain numbers only
    const stringCount = nonEmpty.filter(cell => 
      isNaN(parseFloat(String(cell).replace(/,/g, '')))
    ).length
    
    return stringCount / nonEmpty.length > 0.8
  }
  
  /**
   * Detect if table has multiple header rows
   */
  private detectMultipleHeaders(data: any[][], table: TableStructure): boolean {
    if (table.bounds.endRow - table.bounds.startRow < 2) return false
    
    // Check if second row also looks like headers
    const secondRow = data[table.bounds.startRow + 1] || []
    return this.rowLooksLikeHeader(secondRow)
  }
  
  /**
   * Check if worksheet has formulas
   */
  private hasFormulas(worksheet: XLSX.WorkSheet): boolean {
    for (const cell in worksheet) {
      if (cell[0] !== '!' && worksheet[cell].f) {
        return true
      }
    }
    return false
  }
  
  /**
   * Convert column index to letter
   */
  private getColumnLetter(index: number): string {
    let letter = ''
    while (index >= 0) {
      letter = String.fromCharCode((index % 26) + 65) + letter
      index = Math.floor(index / 26) - 1
    }
    return letter
  }
  
  /**
   * Create default table structure
   */
  private createDefaultTable(dimensions: { rows: number; cols: number }): TableStructure {
    return {
      id: 'main',
      bounds: {
        startRow: 0,
        endRow: dimensions.rows - 1,
        startCol: 0,
        endCol: dimensions.cols - 1
      },
      hasHeaders: true,
      headerRows: 1
    }
  }
}