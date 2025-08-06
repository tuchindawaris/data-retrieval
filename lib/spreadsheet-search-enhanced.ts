import * as XLSX from 'xlsx'
import { getDriveClient } from './google-drive'
import { SheetStructureAnalyzer } from './sheet-structure-analyzer'
import { LLMExtractionGenerator } from './llm-extraction-generator'
import { ExtractionCodeExecutor } from './extraction-code-executor'
import { SpreadsheetSearchAnalyzer } from './spreadsheet-search-analyzer'
import { 
  ExtractionContext,
  SheetStructure 
} from './sheet-structure-types'
import { 
  SpreadsheetSearchRequest,
  SearchIntent,
  SheetMatch 
} from './spreadsheet-search-types'
import { FileMetadata } from './supabase'

export interface EnhancedSearchResult {
  fileId: string
  fileName: string
  sheetName: string
  sheetIndex: number
  relevanceScore: number
  extraction: {
    structure: SheetStructure
    plan: any
    result: any
    executionTime: number
    rowsProcessed?: number
  }
  metadata: {
    totalRows: number
    searchDuration: number
  }
}

export class EnhancedSpreadsheetSearch {
  private structureAnalyzer: SheetStructureAnalyzer
  private extractionGenerator: LLMExtractionGenerator
  private codeExecutor: ExtractionCodeExecutor
  private searchAnalyzer: SpreadsheetSearchAnalyzer
  
  constructor() {
    this.structureAnalyzer = new SheetStructureAnalyzer()
    this.extractionGenerator = new LLMExtractionGenerator()
    this.codeExecutor = new ExtractionCodeExecutor()
    this.searchAnalyzer = new SpreadsheetSearchAnalyzer()
  }
  
  async search(
    request: SpreadsheetSearchRequest,
    files: FileMetadata[],
    accessToken: string
  ): Promise<{
    results: EnhancedSearchResult[]
    query: string
    intent: SearchIntent
    duration: number
  }> {
    const startTime = Date.now()
    
    // Step 1: Analyze intent
    const intent = await this.searchAnalyzer.analyzeQueryIntent(request.query)
    
    // Step 2: Find relevant sheets
    const matchedSheets = await this.searchAnalyzer.matchSheetsToQuery(
      request.query,
      files,
      intent
    )
    
    const relevantSheets = matchedSheets
      .filter(m => m.relevanceScore >= (request.matchThreshold || 0.7))
      .slice(0, request.maxSheets || 10)
    
    // Step 3: Process each sheet
    const results: EnhancedSearchResult[] = []
    
    for (const sheetMatch of relevantSheets) {
      try {
        const result = await this.processSheet(
          sheetMatch,
          request,
          intent,
          files,
          accessToken
        )
        
        if (result) {
          results.push(result)
        }
      } catch (error: any) {
        console.error(`Failed to process ${sheetMatch.fileName}:`, error.message)
      }
    }
    
    return {
      results,
      query: request.query,
      intent,
      duration: Date.now() - startTime
    }
  }
  
  private async processSheet(
    sheetMatch: SheetMatch,
    request: SpreadsheetSearchRequest,
    intent: SearchIntent,
    files: FileMetadata[],
    accessToken: string
  ): Promise<EnhancedSearchResult | null> {
    const searchStartTime = Date.now()
    
    const file = files.find(f => f.file_id === sheetMatch.fileId)
    if (!file) return null
    
    // Load sheet data
    const sheetData = await this.loadSheet(
      accessToken,
      file.file_id,
      file.name,
      file.mime_type,
      sheetMatch.sheetName,
      sheetMatch.sheetIndex
    )
    
    if (!sheetData) return null
    
    // Analyze structure
    const structure = this.structureAnalyzer.analyzeStructure(
      sheetData.worksheet,
      sheetMatch.sheetName
    )
    
    // Create context
    const context: ExtractionContext = {
      sheetStructure: structure,
      query: request.query,
      intent
    }
    
    // Generate extraction code with sample data
    const sampleRows = sheetData.rows.slice(0, 10) // Pass first 10 rows as sample
    const extraction = await this.extractionGenerator.generateExtractionCode(
      context,
      sampleRows
    )
    
    // Execute extraction
    const executionResult = await this.codeExecutor.executeWithRetry(
      extraction,
      sheetData.rows,
      sheetData.headers,
      async (attempt, error) => {
        // Regenerate with error context
        const retryContext: ExtractionContext = {
          ...context,
          query: `${request.query} (Error: ${error}. Adjust the code.)`
        }
        return await this.extractionGenerator.generateExtractionCode(
          retryContext,
          sampleRows
        )
      }
    )
    
    if (!executionResult.success) {
      console.error('Extraction failed:', executionResult.error)
      return null
    }
    
    return {
      fileId: file.file_id,
      fileName: file.name,
      sheetName: sheetMatch.sheetName,
      sheetIndex: sheetMatch.sheetIndex,
      relevanceScore: sheetMatch.relevanceScore,
      extraction: {
        structure,
        plan: extraction,
        result: executionResult.data,
        executionTime: executionResult.executionTime,
        rowsProcessed: executionResult.rowsProcessed
      },
      metadata: {
        totalRows: structure.dimensions.rows,
        searchDuration: Date.now() - searchStartTime
      }
    }
  }
  
  private async loadSheet(
    accessToken: string,
    fileId: string,
    fileName: string,
    mimeType: string,
    sheetName: string,
    sheetIndex: number
  ): Promise<{
    worksheet: XLSX.WorkSheet
    headers: string[]
    rows: any[][]
  } | null> {
    const drive = getDriveClient(accessToken)
    
    try {
      let fileBuffer: Buffer
      
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        const response = await drive.files.export({
          fileId: fileId,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }, { responseType: 'arraybuffer' })
        
        fileBuffer = Buffer.from(response.data as ArrayBuffer)
      } else {
        const response = await drive.files.get({
          fileId: fileId,
          alt: 'media'
        }, { responseType: 'arraybuffer' })
        
        fileBuffer = Buffer.from(response.data as ArrayBuffer)
      }
      
      const workbook = XLSX.read(fileBuffer, {
        cellDates: true,
        cellNF: true,
        cellStyles: true,
        cellFormulas: true,
        type: 'buffer'
      })
      
      const worksheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[sheetIndex]]
      
      if (!worksheet) {
        throw new Error(`Sheet "${sheetName}" not found`)
      }
      
      const data = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        raw: false,
        dateNF: 'yyyy-mm-dd',
        defval: null
      }) as any[][]
      
      if (data.length === 0) {
        return {
          worksheet,
          headers: [],
          rows: []
        }
      }
      
      const headers = (data[0] || []).map((h: any, i: number) => 
        h?.toString().trim() || `Column ${i + 1}`
      )
      
      const rows = data.slice(1).filter(row => Array.isArray(row))
      
      return {
        worksheet,
        headers,
        rows
      }
      
    } catch (error) {
      console.error(`Error loading sheet ${sheetName}:`, error)
      return null
    }
  }
}