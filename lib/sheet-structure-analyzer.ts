import * as XLSX from 'xlsx'
import { 
  SheetStructure, 
  ColumnStructure, 
  TableStructure, 
  DataPatterns 
} from './sheet-structure-types'

export class SheetStructureAnalyzer {
  
  analyzeStructure(
    worksheet: XLSX.WorkSheet,
    sheetName: string
  ): SheetStructure {
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1')
    const dimensions = {
      rows: range.e.r + 1,
      cols: range.e.c + 1
    }
    
    const data = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      raw: false,
      defval: null
    }) as any[][]
    
    const tables = this.detectTables(data, dimensions)
    const mainTable = tables[0] || this.createDefaultTable(dimensions)
    const columns = this.analyzeColumns(data, mainTable)
    const patterns = this.detectPatterns(columns)
    
    const metadata = {
      hasFormulas: this.hasFormulas(worksheet),
      hasMergedCells: !!worksheet['!merges'] && worksheet['!merges'].length > 0,
      hasMultipleHeaders: false,
      dataStartRow: mainTable.bounds.startRow + mainTable.headerRows
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
  
  private detectTables(data: any[][], dimensions: { rows: number; cols: number }): TableStructure[] {
    // Find first non-empty row
    let startRow = 0
    for (let r = 0; r < data.length; r++) {
      const row = data[r] || []
      if (row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
        startRow = r
        break
      }
    }
    
    // Simple table detection - assume one main table
    return [{
      id: 'main',
      bounds: {
        startRow,
        endRow: dimensions.rows - 1,
        startCol: 0,
        endCol: dimensions.cols - 1
      },
      hasHeaders: true,
      headerRows: 1
    }]
  }
  
  private analyzeColumns(data: any[][], table: TableStructure): ColumnStructure[] {
    const columns: ColumnStructure[] = []
    const headerRow = data[table.bounds.startRow] || []
    
    for (let c = 0; c < headerRow.length; c++) {
      const header = headerRow[c] || `Column ${c + 1}`
      const columnData: any[] = []
      
      for (let r = table.bounds.startRow + 1; r <= table.bounds.endRow && r < data.length; r++) {
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
        hasFormula: false
      }
      
      columns.push(column)
    }
    
    return columns
  }
  
  private detectPatterns(columns: ColumnStructure[]): DataPatterns {
    return {
      emptyColumns: columns.filter(c => c.density === 0).map(c => c.index),
      sparseColumns: columns.filter(c => c.density > 0 && c.density < 0.3)
        .map(c => ({ index: c.index, density: c.density })),
      formulaColumns: [],
      mergedCellRegions: []
    }
  }
  
  private inferDataType(values: any[]): ColumnStructure['dataType'] {
    if (values.length === 0) return 'empty'
    
    const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '')
    if (nonEmpty.length === 0) return 'empty'
    
    const types = { number: 0, date: 0, string: 0 }
    
    nonEmpty.forEach(value => {
      const strValue = String(value)
      if (!isNaN(parseFloat(strValue.replace(/[,$]/g, '')))) {
        types.number++
      } else if (!isNaN(Date.parse(strValue))) {
        types.date++
      } else {
        types.string++
      }
    })
    
    const total = nonEmpty.length
    if (types.number / total > 0.7) return 'number'
    if (types.date / total > 0.7) return 'date'
    if (types.string / total > 0.7) return 'string'
    
    return 'mixed'
  }
  
  private calculateDensity(values: any[]): number {
    if (values.length === 0) return 0
    const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '').length
    return Math.round((nonEmpty / values.length) * 100) / 100
  }
  
  private countUniqueValues(values: any[]): number {
    const unique = new Set(
      values
        .filter(v => v !== null && v !== undefined && v !== '')
        .slice(0, 1000)
    )
    return unique.size
  }
  
  private hasFormulas(worksheet: XLSX.WorkSheet): boolean {
    for (const cell in worksheet) {
      if (cell[0] !== '!' && worksheet[cell].f) {
        return true
      }
    }
    return false
  }
  
  private getColumnLetter(index: number): string {
    let letter = ''
    while (index >= 0) {
      letter = String.fromCharCode((index % 26) + 65) + letter
      index = Math.floor(index / 26) - 1
    }
    return letter
  }
  
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