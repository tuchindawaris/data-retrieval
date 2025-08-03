import * as XLSX from 'xlsx'
import { google } from 'googleapis'
import { getDriveClient } from './google-drive'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

interface ColumnMetadata {
  name: string
  letter: string
  dataType: 'string' | 'number' | 'date' | 'boolean' | 'mixed' | 'empty'
  format?: string
  nonEmptyRows: number
}

interface SheetMetadata {
  name: string
  index: number
  columns: ColumnMetadata[]
  totalRows: number
}

// Analyze column to determine data type and format
function analyzeColumn(data: any[], header: string): ColumnMetadata {
  const nonEmptyValues = data.filter(v => v !== null && v !== undefined && v !== '')
  
  if (nonEmptyValues.length === 0) {
    return {
      name: header || 'Unnamed',
      letter: '',
      dataType: 'empty',
      nonEmptyRows: 0
    }
  }

  // Count types
  const types = { string: 0, number: 0, date: 0, boolean: 0 }
  let format: string | undefined
  
  nonEmptyValues.forEach(value => {
    if (typeof value === 'boolean') {
      types.boolean++
    } else if (typeof value === 'number') {
      types.number++
    } else if (value instanceof Date) {
      types.date++
    } else if (typeof value === 'string') {
      // Check if string is actually a date
      const dateVal = Date.parse(value)
      if (!isNaN(dateVal) && value.match(/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/)) {
        types.date++
      } else {
        types.string++
      }
    }
  })

  // Determine primary type (>80% threshold)
  const total = nonEmptyValues.length
  let dataType: ColumnMetadata['dataType'] = 'mixed'
  
  if (types.string / total > 0.8) dataType = 'string'
  else if (types.number / total > 0.8) dataType = 'number'
  else if (types.date / total > 0.8) dataType = 'date'
  else if (types.boolean / total > 0.8) dataType = 'boolean'

  // Detect formats for numbers
  if (dataType === 'number' && nonEmptyValues.length > 0) {
    const sample = nonEmptyValues.slice(0, 10).join(' ')
    if (sample.includes('$') || sample.includes('¥') || sample.includes('€')) {
      format = 'currency'
    } else if (sample.includes('%')) {
      format = 'percentage'
    }
  }

  return {
    name: header || 'Unnamed',
    letter: '',
    dataType,
    format,
    nonEmptyRows: nonEmptyValues.length
  }
}

// Convert column index to letter (0 -> A, 1 -> B, etc.)
function getColumnLetter(index: number): string {
  let letter = ''
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter
    index = Math.floor(index / 26) - 1
  }
  return letter
}

export async function processSpreadsheet(
  accessToken: string,
  fileId: string,
  fileName: string,
  mimeType: string
): Promise<SheetMetadata[]> {
  let tempFilePath: string | null = null
  
  try {
    // Download file to buffer first
    const drive = getDriveClient(accessToken)
    let fileBuffer: Buffer
    
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      // Export Google Sheets as xlsx
      console.log(`Exporting Google Sheet ${fileName} as xlsx...`)
      const response = await drive.files.export({
        fileId: fileId,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }, { responseType: 'arraybuffer' })
      
      fileBuffer = Buffer.from(response.data as ArrayBuffer)
    } else {
      // Download other files as-is
      console.log(`Downloading file ${fileName}...`)
      const response = await drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, { responseType: 'arraybuffer' })
      
      fileBuffer = Buffer.from(response.data as ArrayBuffer)
    }

    console.log(`Processing ${fileName} with SheetJS (${fileBuffer.length} bytes)...`)
    
    // Process with SheetJS directly from buffer
    const workbook = XLSX.read(fileBuffer, {
      cellDates: true,
      cellNF: true,
      cellStyles: true,
      type: 'buffer'
    })

    const sheetsMetadata: SheetMetadata[] = []

    workbook.SheetNames.forEach((sheetName, index) => {
      const worksheet = workbook.Sheets[sheetName]
      
      // Convert to JSON to analyze
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        raw: false,
        dateNF: 'yyyy-mm-dd'
      })

      if (jsonData.length === 0) {
        console.log(`Sheet "${sheetName}": ${columns.length} valid columns (from ${headers.length} total), ${dataRows.length} rows`)

      sheetsMetadata.push({
          name: sheetName,
          index,
          columns: [],
          totalRows: 0
        })
        return
      }

      // Get headers from first row
      const headers = (jsonData[0] as any[]) || []
      const dataRows = jsonData.slice(1) as any[][]

      // Filter out completely empty columns (where header is undefined/null/empty and all data is empty)
      const validColumnIndices: number[] = []
      for (let i = 0; i < headers.length; i++) {
        const hasHeader = headers[i] !== undefined && headers[i] !== null && headers[i] !== ''
        const hasData = dataRows.some(row => row[i] !== undefined && row[i] !== null && row[i] !== '')
        if (hasHeader || hasData) {
          validColumnIndices.push(i)
        }
      }

      // Analyze each valid column
      const columns: ColumnMetadata[] = []
      validColumnIndices.forEach((colIndex, idx) => {
        const header = headers[colIndex]
        const columnData = dataRows.map(row => row[colIndex])
        const metadata = analyzeColumn(columnData, String(header || `Column ${colIndex + 1}`))
        metadata.letter = getColumnLetter(colIndex) // Use original column index for letter
        columns.push(metadata)
      })

      sheetsMetadata.push({
        name: sheetName,
        index,
        columns,
        totalRows: dataRows.length
      })
    })

    console.log(`Successfully processed ${fileName}: ${sheetsMetadata.length} sheets`)
    return sheetsMetadata

  } catch (error) {
    console.error(`Error processing spreadsheet ${fileName}:`, error)
    throw error
  }
}