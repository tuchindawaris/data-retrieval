// lib/spreadsheet-data-retriever.ts

import * as XLSX from 'xlsx'
import { getDriveClient } from './google-drive'
import { CachedSpreadsheet, CachedSheet, SearchFilter, ColumnMatchResult } from './spreadsheet-search-types'

interface RetrieveOptions {
  keyColumns?: ColumnMatchResult[]
  filters?: SearchFilter[]
  maxRows?: number
  includeEmptyRows?: boolean
}

export class SpreadsheetDataRetriever {
  private cache: Map<string, CachedSpreadsheet>
  private cacheTimeout: number = 30 * 60 * 1000 // 30 minutes
  
  constructor() {
    this.cache = new Map()
  }
  
  /**
   * Retrieve filtered data from a specific sheet
   */
  async retrieveSheetData(
    accessToken: string,
    fileId: string,
    fileName: string,
    mimeType: string,
    sheetName: string,
    sheetIndex: number,
    options: RetrieveOptions = {}
  ): Promise<{
    headers: string[]
    rows: any[][]
    totalRows: number
    truncated: boolean
    cacheHit: boolean
  }> {
    const startTime = Date.now()
    
    // Check cache first
    const cacheKey = `${fileId}:${sheetName}`
    const cached = await this.getCachedSheet(fileId, sheetName)
    
    let sheetData: CachedSheet
    let cacheHit = false
    
    if (cached) {
      sheetData = cached
      cacheHit = true
      console.log(`Cache hit for ${fileName}:${sheetName}`)
    } else {
      console.log(`Loading ${fileName}:${sheetName} from Drive...`)
      sheetData = await this.loadSheetFromDrive(
        accessToken,
        fileId,
        fileName,
        mimeType,
        sheetName,
        sheetIndex
      )
      
      // Cache the data
      this.cacheSheet(fileId, fileName, sheetData)
    }
    
    // Apply filters and extract relevant rows
    const filteredData = this.filterData(
      sheetData,
      options.keyColumns,
      options.filters,
      options.includeEmptyRows
    )
    
    // Apply row limit
    const maxRows = options.maxRows || 1000
    const truncated = filteredData.rows.length > maxRows
    const finalRows = filteredData.rows.slice(0, maxRows)
    
    console.log(`Retrieved ${finalRows.length} rows (${truncated ? 'truncated' : 'complete'}) in ${Date.now() - startTime}ms`)
    
    return {
      headers: filteredData.headers,
      rows: finalRows,
      totalRows: filteredData.rows.length,
      truncated,
      cacheHit
    }
  }
  
  /**
   * Load sheet data from Google Drive
   */
  private async loadSheetFromDrive(
    accessToken: string,
    fileId: string,
    fileName: string,
    mimeType: string,
    sheetName: string,
    sheetIndex: number
  ): Promise<CachedSheet> {
    const drive = getDriveClient(accessToken)
    let fileBuffer: Buffer
    
    try {
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        // Export Google Sheets as xlsx
        const response = await drive.files.export({
          fileId: fileId,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }, { responseType: 'arraybuffer' })
        
        fileBuffer = Buffer.from(response.data as ArrayBuffer)
      } else {
        // Download other files as-is
        const response = await drive.files.get({
          fileId: fileId,
          alt: 'media'
        }, { responseType: 'arraybuffer' })
        
        fileBuffer = Buffer.from(response.data as ArrayBuffer)
      }
      
      // Parse with SheetJS
      const workbook = XLSX.read(fileBuffer, {
        cellDates: true,
        cellNF: true,
        cellStyles: true,
        type: 'buffer'
      })
      
      // Get the specific sheet
      const worksheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[sheetIndex]]
      
      if (!worksheet) {
        throw new Error(`Sheet "${sheetName}" not found in ${fileName}`)
      }
      
      // Convert to array of arrays
      const data = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        raw: false,
        dateNF: 'yyyy-mm-dd',
        defval: null
      }) as any[][]
      
      if (data.length === 0) {
        return {
          name: sheetName,
          index: sheetIndex,
          headers: [],
          data: [],
          totalRows: 0
        }
      }
      
      // Extract headers from first row
      const headers = (data[0] || []).map((h: any, i: number) => 
        h?.toString().trim() || `Column ${i + 1}`
      )
      
      return {
        name: sheetName,
        index: sheetIndex,
        headers,
        data: data.slice(1), // Exclude header row
        totalRows: data.length - 1
      }
      
    } catch (error) {
      console.error(`Error loading sheet ${sheetName} from ${fileName}:`, error)
      throw error
    }
  }
  
  /**
   * Filter data based on key columns and filters
   */
  private filterData(
    sheet: CachedSheet,
    keyColumns?: ColumnMatchResult[],
    filters?: SearchFilter[],
    includeEmptyRows: boolean = false
  ): {
    headers: string[]
    rows: any[][]
  } {
    let headers = sheet.headers
    let rows = sheet.data
    
    // Filter out completely empty rows unless requested
    if (!includeEmptyRows) {
      rows = rows.filter(row => 
        row.some(cell => cell !== null && cell !== undefined && cell !== '')
      )
    }
    
    // Apply column filters
    if (filters && filters.length > 0) {
      rows = rows.filter(row => {
        return filters.every(filter => {
          const colIndex = headers.findIndex(h => 
            h.toLowerCase().includes(filter.column.toLowerCase())
          )
          
          if (colIndex === -1) return true // Skip if column not found
          
          const value = row[colIndex]
          return this.evaluateFilter(value, filter)
        })
      })
    }
    
    // If key columns specified, filter rows that have non-empty values in those columns
    if (keyColumns && keyColumns.length > 0) {
      rows = rows.filter(row => {
        return keyColumns.some(col => {
          const value = row[col.index]
          return value !== null && value !== undefined && value !== ''
        })
      })
    }
    
    return { headers, rows }
  }
  
  /**
   * Evaluate a single filter condition
   */
  private evaluateFilter(value: any, filter: SearchFilter): boolean {
    if (value === null || value === undefined) return false
    
    const strValue = String(value).toLowerCase()
    const filterValue = String(filter.value).toLowerCase()
    
    switch (filter.operator) {
      case 'equals':
        return strValue === filterValue
        
      case 'contains':
        return strValue.includes(filterValue)
        
      case 'greater':
        const numValue = parseFloat(strValue.replace(/[$,]/g, ''))
        const numFilter = parseFloat(filterValue.replace(/[$,]/g, ''))
        return !isNaN(numValue) && !isNaN(numFilter) && numValue > numFilter
        
      case 'less':
        const numValue2 = parseFloat(strValue.replace(/[$,]/g, ''))
        const numFilter2 = parseFloat(filterValue.replace(/[$,]/g, ''))
        return !isNaN(numValue2) && !isNaN(numFilter2) && numValue2 < numFilter2
        
      case 'between':
        if (Array.isArray(filter.value) && filter.value.length === 2) {
          const num = parseFloat(strValue.replace(/[$,]/g, ''))
          const min = parseFloat(String(filter.value[0]).replace(/[$,]/g, ''))
          const max = parseFloat(String(filter.value[1]).replace(/[$,]/g, ''))
          return !isNaN(num) && !isNaN(min) && !isNaN(max) && num >= min && num <= max
        }
        return false
        
      default:
        return true
    }
  }
  
  /**
   * Get cached sheet if available and not expired
   */
  private getCachedSheet(fileId: string, sheetName: string): CachedSheet | null {
    const cached = this.cache.get(fileId)
    
    if (!cached || Date.now() > cached.expiresAt) {
      this.cache.delete(fileId)
      return null
    }
    
    const sheet = cached.sheets.find(s => s.name === sheetName)
    return sheet || null
  }
  
  /**
   * Cache sheet data
   */
  private cacheSheet(fileId: string, fileName: string, sheet: CachedSheet): void {
    const existing = this.cache.get(fileId) || {
      fileId,
      fileName,
      sheets: [],
      cachedAt: Date.now(),
      expiresAt: Date.now() + this.cacheTimeout
    }
    
    // Update or add sheet
    const sheetIndex = existing.sheets.findIndex(s => s.name === sheet.name)
    if (sheetIndex >= 0) {
      existing.sheets[sheetIndex] = sheet
    } else {
      existing.sheets.push(sheet)
    }
    
    this.cache.set(fileId, existing)
    
    // Clean up old cache entries
    this.cleanupCache()
  }
  
  /**
   * Remove expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now()
    const expiredKeys: string[] = []
    
    this.cache.forEach((value, key) => {
      if (now > value.expiresAt) {
        expiredKeys.push(key)
      }
    })
    
    expiredKeys.forEach(key => this.cache.delete(key))
    
    // Also limit cache size to prevent memory issues
    const maxCacheSize = 50
    if (this.cache.size > maxCacheSize) {
      // Remove oldest entries
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
      
      const toRemove = entries.slice(0, entries.length - maxCacheSize)
      toRemove.forEach(([key]) => this.cache.delete(key))
    }
  }
  
  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear()
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number
    entries: Array<{ fileId: string; fileName: string; sheets: number; cachedAt: Date }>
  } {
    const entries = Array.from(this.cache.values()).map(entry => ({
      fileId: entry.fileId,
      fileName: entry.fileName,
      sheets: entry.sheets.length,
      cachedAt: new Date(entry.cachedAt)
    }))
    
    return {
      size: this.cache.size,
      entries
    }
  }
}