// Shared type definitions for knowledge map schemas
// Ensures parallelism between Drive and Database structures

// ============ Drive Types ============
export interface DriveKnowledgeMap {
  timestamp: string
  source: 'drive'
  totalItems: number
  knowledgeTree: FolderNode[]
  statistics: DriveStatistics
}

export interface FolderNode {
  id: string
  name: string
  type: 'folder'
  path: string
  children: (FolderNode | FileNode)[]
  metadata: {
    parentFolderId: string | null
    modifiedTime?: string
  }
}

export interface FileNode {
  id: string
  name: string
  type: 'file'
  mimeType: string
  size: number
  path: string
  metadata: {
    isSpreadsheet?: boolean
    isDocument?: boolean
    summary?: string
    summaryStatus?: 'success' | 'failed' | 'pending'
    sheets?: SheetInfo[]
    processedAt?: string
    spreadsheetError?: string
  }
}

export interface SheetInfo {
  name: string
  index: number
  totalRows: number
  summary?: string
  columns: ColumnInfo[]
}

export interface ColumnInfo {
  name: string
  letter: string
  dataType: 'string' | 'number' | 'date' | 'boolean' | 'mixed' | 'empty'
  format?: string
  nonEmptyRows: number
}

export interface DriveStatistics {
  folders: number
  files: number
  spreadsheets: number
  documents: number
  processedSpreadsheets: number
  filesWithSummaries: number
  filesWithFailedSummaries: number
  totalSheets: number
  totalColumns: number
  totalSize: number
}

// ============ Database Types ============
export interface DatabaseKnowledgeMap {
  timestamp: string
  source: 'database'
  totalItems: number
  knowledgeTree: TableNode[]
  statistics: DatabaseStatistics
}

export interface TableNode {
  id: string
  name: string
  type: 'table'
  schema?: string
  columns: ColumnNode[]
  metadata: {
    rowCount?: number
    sizeEstimate?: number
    lastAnalyzed?: string
    indexes?: IndexInfo[]
    primaryKey?: string[]
    foreignKeys?: ForeignKeyInfo[]
  }
}

export interface ColumnNode {
  name: string
  dataType: string
  isNullable: boolean
  ordinalPosition?: number
  metadata: {
    defaultValue?: any
    isPrimaryKey?: boolean
    isForeignKey?: boolean
    isUnique?: boolean
    constraints?: string[]
    referencedTable?: string
    referencedColumn?: string
  }
}

export interface IndexInfo {
  name: string
  columns: string[]
  isUnique: boolean
  isPrimary: boolean
}

export interface ForeignKeyInfo {
  constraintName: string
  column: string
  referencedTable: string
  referencedColumn: string
}

export interface DatabaseStatistics {
  schemas: number
  tables: number
  views: number
  totalColumns: number
  columnsWithDefaults: number
  tablesWithPrimaryKeys: number
  tablesWithIndexes: number
  foreignKeyRelationships: number
  nullableColumns: number
  nonNullableColumns: number
}