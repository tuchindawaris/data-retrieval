// lib/spreadsheet-search-types.ts

export interface SpreadsheetSearchRequest {
  query: string
  matchThreshold?: number // 0-1 relevance score
  maxSheets?: number // limit results
  includeEmptyRows?: boolean
}

export interface SpreadsheetSearchResult {
  fileId: string
  fileName: string
  sheetName: string
  sheetIndex: number
  relevanceScore: number
  matchedColumns: MatchedColumn[]
  data: {
    headers: string[]
    rows: any[][]
    totalRowsFound: number
    truncated: boolean
  }
  metadata: {
    totalRows: number
    searchDuration: number
    cacheHit: boolean
  }
}

export interface MatchedColumn {
  columnName: string
  columnLetter: string
  columnIndex: number
  matchConfidence: number
  matchReason: 'exact' | 'semantic' | 'fuzzy' | 'inferred'
}

export interface SheetMatch {
  fileId: string
  fileName: string
  sheetName: string
  sheetIndex: number
  relevanceScore: number
  matchReasons: string[]
}

export interface SearchIntent {
  type: 'lookup' | 'filter' | 'aggregate' | 'list'
  targetColumns: string[]
  filters?: SearchFilter[]
  aggregations?: AggregationType[]
}

export interface SearchFilter {
  column: string
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'between'
  value: any
}

export type AggregationType = 'sum' | 'count' | 'average' | 'min' | 'max'

export interface ColumnMatchResult {
  column: string
  index: number
  confidence: number
  method: 'exact' | 'fuzzy' | 'semantic' | 'pattern'
}

export interface CachedSpreadsheet {
  fileId: string
  fileName: string
  sheets: CachedSheet[]
  cachedAt: number
  expiresAt: number
}

export interface CachedSheet {
  name: string
  index: number
  headers: string[]
  data: any[][]
  totalRows: number
}