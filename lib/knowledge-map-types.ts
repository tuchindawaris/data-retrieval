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
  unsupportedFiles: number
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

// Export the FolderNode type so it can be shared between components
export interface FolderNode {
  id: string
  name: string
  path: string
  files: FileMetadata[]
  subfolders: FolderNode[]
}

// You may also want to export these file group constants
export const FILE_GROUPS = {
  spreadsheet: {
    color: '#10b981', // green
    label: 'Spreadsheets',
    extensions: ['xlsx', 'xls', 'csv', 'ods'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.oasis.opendocument.spreadsheet'
    ]
  },
  document: {
    color: '#3b82f6', // blue
    label: 'Documents',
    extensions: ['txt', 'md', 'doc', 'docx', 'rtf', 'odt'],
    mimeTypes: [
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.google-apps.document',
      'application/rtf',
      'application/vnd.oasis.opendocument.text'
    ]
  },
  unsupported: {
    color: '#6b7280', // gray
    label: 'Not Supported Yet',
    extensions: [],
    mimeTypes: []
  }
} as const

// Helper function to determine file group
export function getFileGroup(mimeType: string, fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  
  if (FILE_GROUPS.spreadsheet.mimeTypes.includes(mimeType) || 
      FILE_GROUPS.spreadsheet.extensions.includes(extension)) {
    return { key: 'spreadsheet' as const, ...FILE_GROUPS.spreadsheet }
  }
  
  if (FILE_GROUPS.document.mimeTypes.includes(mimeType) || 
      FILE_GROUPS.document.extensions.includes(extension)) {
    return { key: 'document' as const, ...FILE_GROUPS.document }
  }
  
  return { key: 'unsupported' as const, ...FILE_GROUPS.unsupported }
}