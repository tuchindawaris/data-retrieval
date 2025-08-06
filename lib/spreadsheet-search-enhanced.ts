// lib/spreadsheet-search-enhanced.ts

import * as XLSX from 'xlsx'
import { getDriveClient } from './google-drive'
import { SheetStructureAnalyzer } from './sheet-structure-analyzer'
import { LLMExtractionGenerator } from './llm-extraction-generator'
import { ExtractionCodeExecutor } from './extraction-code-executor'
import { SpreadsheetSearchAnalyzer } from './spreadsheet-search-analyzer'
import { 
  ExtractionContext,
  GeneratedExtraction,
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
    plan: GeneratedExtraction
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
  
  /**
   * Perform enhanced search with LLM-generated extraction
   */
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
    
    console.log('\n=== ENHANCED SPREADSHEET SEARCH ===')
    console.log('Query:', request.query)
    
    // Step 1: Analyze query intent
    console.log('\n--- Analyzing query intent ---')
    const intent = await this.searchAnalyzer.analyzeQueryIntent(request.query)
    console.log('Intent:', JSON.stringify(intent, null, 2))
    
    // Step 2: Find relevant sheets
    console.log('\n--- Finding relevant sheets ---')
    const matchedSheets = await this.searchAnalyzer.matchSheetsToQuery(
      request.query,
      files,
      intent
    )
    
    const relevantSheets = matchedSheets
      .filter(m => m.relevanceScore >= (request.matchThreshold || 0.7))
      .slice(0, request.maxSheets || 10)
    
    console.log(`Found ${relevantSheets.length} relevant sheets`)
    
    if (relevantSheets.length === 0) {
      return {
        results: [],
        query: request.query,
        intent,
        duration: Date.now() - startTime
      }
    }
    
    // Step 3: Process each sheet with LLM extraction
    const results: EnhancedSearchResult[] = []
    
    for (const sheetMatch of relevantSheets) {
      try {
        console.log(`\n--- Processing ${sheetMatch.fileName} - ${sheetMatch.sheetName} ---`)
        
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
    
    const duration = Date.now() - startTime
    console.log(`\n=== Search completed in ${duration}ms ===`)
    
    return {
      results,
      query: request.query,
      intent,
      duration
    }
  }
  
  /**
   * Process individual sheet with LLM extraction
   */
  private async processSheet(
    sheetMatch: SheetMatch,
    request: SpreadsheetSearchRequest,
    intent: SearchIntent,
    files: FileMetadata[],
    accessToken: string
  ): Promise<EnhancedSearchResult | null> {
    const searchStartTime = Date.now()
    
    // Get file metadata
    const file = files.find(f => f.file_id === sheetMatch.fileId)
    if (!file) {
      console.error('File not found:', sheetMatch.fileId)
      return null
    }
    
    // Load sheet data
    console.log('Loading sheet data...')
    const sheetData = await this.loadSheet(
      accessToken,
      file.file_id,
      file.name,
      file.mime_type,
      sheetMatch.sheetName,
      sheetMatch.sheetIndex
    )
    
    if (!sheetData) {
      console.error('Failed to load sheet data')
      return null
    }
    
    // Analyze sheet structure
    console.log('Analyzing sheet structure...')
    const structure = this.structureAnalyzer.analyzeStructure(
      sheetData.worksheet,
      sheetMatch.sheetName
    )
    
    console.log(`Structure: ${structure.dimensions.rows} rows, ${structure.dimensions.cols} columns`)
    console.log(`Tables found: ${structure.tables.length}`)
    
    // Generate extraction context
    const context: ExtractionContext = {
      sheetStructure: structure,
      query: request.query,
      intent
    }
    
    // Generate extraction code
    console.log('Generating extraction code...')
    const extraction = await this.extractionGenerator.generateExtractionCode(context)
    
    console.log('Extraction plan:', extraction.description)
    console.log(`Confidence: ${extraction.confidence}`)
    if (extraction.warnings?.length) {
      console.warn('Warnings:', extraction.warnings)
    }
    
    // Log available columns for debugging
    console.log('Available columns:', sheetData.headers.map((h, i) => `${i}: "${h}"`).join(', '))
    
    // Execute extraction with retry
    console.log('Executing extraction...')
    console.log(`Data dimensions: ${sheetData.rows.length} rows, ${sheetData.headers.length} columns`)
    const executionResult = await this.codeExecutor.executeWithRetry(
      extraction,
      sheetData.rows,
      sheetData.headers,
      async (attempt, error) => {
        // Regenerate code based on error
        console.log(`Regenerating code after error: ${error}`)
        
        // Add more context about the error
        let errorContext = error;
        if (error.includes('Cannot read properties of undefined')) {
          errorContext += '. Make sure to check if arrays exist before accessing .length or array indices.';
        }
        
        const retryContext: ExtractionContext = {
          ...context,
          query: `${request.query} (Previous attempt failed with: ${errorContext}. Please adjust the code to handle this error. Remember to ALWAYS check if arrays exist and have valid length before accessing them.)`
        }
        
        return await this.extractionGenerator.generateExtractionCode(retryContext)
      }
    )
    
    if (!executionResult.success) {
      console.error('Extraction failed:', executionResult.error)
      return null
    }
    
    console.log(`Extraction successful in ${executionResult.executionTime}ms`)
    if (executionResult.rowsProcessed) {
      console.log(`Rows processed: ${executionResult.rowsProcessed}`)
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
  
  /**
   * Load sheet data from Google Drive
   */
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
        cellFormulas: true,
        type: 'buffer'
      })
      
      // Get the specific sheet
      const worksheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[sheetIndex]]
      
      if (!worksheet) {
        throw new Error(`Sheet "${sheetName}" not found`)
      }
      
      // Convert to array format
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
      
      // Extract headers and rows
      const headers = (data[0] || []).map((h: any, i: number) => 
        h?.toString().trim() || `Column ${i + 1}`
      )
      
      // Ensure we always return valid arrays
      const rows = data.slice(1).filter(row => Array.isArray(row))
      
      return {
        worksheet,
        headers: headers || [],
        rows: rows || []
      }
      
    } catch (error) {
      console.error(`Error loading sheet ${sheetName}:`, error)
      return null
    }
  }
}