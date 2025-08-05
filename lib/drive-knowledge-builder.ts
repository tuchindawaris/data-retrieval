import { FileMetadata } from './supabase'
import { 
  DriveKnowledgeMap, 
  FolderNode, 
  FileNode, 
  DriveStatistics,
  SheetInfo,
  ColumnInfo
} from './knowledge-map-types'

/**
 * Builds a complete Drive knowledge map from file metadata
 */
export function buildDriveKnowledgeMap(files: FileMetadata[]): DriveKnowledgeMap {
  const tree = buildFolderTree(files)
  const statistics = calculateDriveStatistics(files)
  
  return {
    timestamp: new Date().toISOString(),
    source: 'drive',
    totalItems: files.length,
    knowledgeTree: tree,
    statistics
  }
}

/**
 * Builds hierarchical folder/file tree from flat file list
 */
export function buildFolderTree(files: FileMetadata[]): FolderNode[] {
  const folderMap = new Map<string, FolderNode>()
  const fileMap = new Map<string, FileNode>()
  const rootItems: (FolderNode | FileNode)[] = []
  
  // First pass: Create all folders and files
  files.forEach(file => {
    if (file.metadata?.isFolder) {
      const folderNode: FolderNode = {
        id: file.file_id,
        name: file.name,
        type: 'folder',
        path: file.folder_path,
        children: [],
        metadata: {
          parentFolderId: file.metadata.parentFolderId || null,
          modifiedTime: file.metadata.modifiedTime
        }
      }
      folderMap.set(file.file_id, folderNode)
    } else {
      const fileNode: FileNode = {
        id: file.file_id,
        name: file.name,
        type: 'file',
        mimeType: file.mime_type,
        size: file.size,
        path: file.folder_path,
        metadata: {
          isSpreadsheet: file.metadata?.isSpreadsheet || false,
          isDocument: file.metadata?.isDocument || false,
          summary: file.metadata?.summary,
          summaryStatus: file.metadata?.summaryStatus,
          sheets: formatSheets(file.metadata?.sheets),
          processedAt: file.metadata?.processedAt,
          spreadsheetError: file.metadata?.spreadsheetError
        }
      }
      fileMap.set(file.file_id, fileNode)
    }
  })
  
  // Second pass: Build hierarchy
  folderMap.forEach(folder => {
    const parentId = folder.metadata.parentFolderId
    if (parentId && folderMap.has(parentId)) {
      folderMap.get(parentId)!.children.push(folder)
    } else {
      rootItems.push(folder)
    }
  })
  
  // Third pass: Add files to their parent folders
  files.forEach(file => {
    if (!file.metadata?.isFolder) {
      const parentId = file.metadata?.parentFolderId
      const fileNode = fileMap.get(file.file_id)
      
      if (fileNode) {
        if (parentId && folderMap.has(parentId)) {
          folderMap.get(parentId)!.children.push(fileNode)
        } else if (!parentId) {
          rootItems.push(fileNode)
        }
      }
    }
  })
  
  // Sort children alphabetically
  const sortChildren = (items: (FolderNode | FileNode)[]) => {
    items.sort((a, b) => {
      // Folders first, then files
      if (a.type === 'folder' && b.type === 'file') return -1
      if (a.type === 'file' && b.type === 'folder') return 1
      return a.name.localeCompare(b.name)
    })
    
    // Recursively sort folder children
    items.forEach(item => {
      if (item.type === 'folder') {
        sortChildren(item.children)
      }
    })
  }
  
  sortChildren(rootItems)
  
  // Return only FolderNodes at root level (filter out loose files if needed)
  return rootItems.filter((item): item is FolderNode => item.type === 'folder')
}

/**
 * Format sheet metadata for the knowledge map
 */
function formatSheets(sheets: any[] | undefined): SheetInfo[] | undefined {
  if (!sheets || !Array.isArray(sheets)) return undefined
  
  return sheets.map(sheet => ({
    name: sheet.name || 'Unnamed',
    index: sheet.index || 0,
    totalRows: sheet.totalRows || 0,
    summary: sheet.summary,
    columns: formatColumns(sheet.columns)
  }))
}

/**
 * Format column metadata for the knowledge map
 */
function formatColumns(columns: any[] | undefined): ColumnInfo[] {
  if (!columns || !Array.isArray(columns)) return []
  
  return columns
    .filter(col => col) // Filter out null/undefined columns
    .map(col => ({
      name: col.name || 'Unnamed',
      letter: col.letter || '',
      dataType: col.dataType || 'unknown',
      format: col.format,
      nonEmptyRows: col.nonEmptyRows || 0
    }))
}

/**
 * Calculate comprehensive statistics for Drive files
 */
function calculateDriveStatistics(files: FileMetadata[]): DriveStatistics {
  const stats: DriveStatistics = {
    folders: 0,
    files: 0,
    spreadsheets: 0,
    documents: 0,
    unsupportedFiles: 0,
    processedSpreadsheets: 0,
    filesWithSummaries: 0,
    filesWithFailedSummaries: 0,
    totalSheets: 0,
    totalColumns: 0,
    totalSize: 0
  }
  
  files.forEach(file => {
    // Count folders vs files
    if (file.metadata?.isFolder) {
      stats.folders++
    } else {
      stats.files++
      stats.totalSize += file.size || 0
      
      // Count file types
      if (file.metadata?.isSpreadsheet) {
        stats.spreadsheets++
        if (file.metadata?.sheets) {
          stats.processedSpreadsheets++
          stats.totalSheets += file.metadata.sheets.length || 0
          
          // Count columns
          file.metadata.sheets.forEach((sheet: any) => {
            if (sheet.columns) {
              stats.totalColumns += sheet.columns.filter((c: any) => c).length
            }
          })
        }
      } else if (file.metadata?.isDocument) {
        stats.documents++
      } else {
        // File is neither spreadsheet nor document - it's unsupported
        stats.unsupportedFiles++
      }
      
      // Count summaries
      if (file.metadata?.summary) {
        stats.filesWithSummaries++
      }
      if (file.metadata?.summaryStatus === 'failed') {
        stats.filesWithFailedSummaries++
      }
    }
  })
  
  return stats
}