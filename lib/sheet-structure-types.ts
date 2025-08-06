export interface SheetStructure {
  sheetName: string
  dimensions: {
    rows: number
    cols: number
  }
  columns: ColumnStructure[]
  tables: TableStructure[]
  patterns: DataPatterns
  metadata: {
    hasFormulas: boolean
    hasMergedCells: boolean
    hasMultipleHeaders: boolean
    dataStartRow: number
  }
}

export interface ColumnStructure {
  index: number
  name: string
  letter: string
  dataType: 'string' | 'number' | 'date' | 'boolean' | 'currency' | 'percentage' | 'mixed' | 'empty'
  density: number
  uniqueValueCount?: number
  hasFormula: boolean
  samplePatterns?: string[]
}

export interface TableStructure {
  id: string
  bounds: {
    startRow: number
    endRow: number
    startCol: number
    endCol: number
  }
  hasHeaders: boolean
  headerRows: number
  name?: string
}

export interface DataPatterns {
  emptyColumns: number[]
  sparseColumns: Array<{ index: number; density: number }>
  formulaColumns: number[]
  mergedCellRegions: Array<{
    startRow: number
    endRow: number
    startCol: number
    endCol: number
  }>
}

export interface ExtractionContext {
  sheetStructure: SheetStructure
  query: string
  intent: {
    type: 'aggregate' | 'filter' | 'lookup' | 'list' | 'analyze'
    targetColumns: string[]
    keyColumn?: string
    filters?: Array<{
      column: string
      operator: string
      value: any
    }>
    aggregations?: string[]
    timeframe?: string
  }
}

export interface GeneratedExtraction {
  code: string
  description: string
  expectedOutputFormat: string
  confidence: number
  warnings?: string[]
}

export interface ExtractionResult {
  success: boolean
  data?: any
  error?: string
  executionTime: number
  rowsProcessed?: number
}