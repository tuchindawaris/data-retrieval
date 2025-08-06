'use client'

import { useState } from 'react'
import SpreadsheetDataTable from './SpreadsheetDataTable'

interface SpreadsheetResultCardProps {
  result: any
  rank: number
}

export default function SpreadsheetResultCard({ result, rank }: SpreadsheetResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [showRawData, setShowRawData] = useState(false)
  
  const relevancePercentage = Math.round(result.relevanceScore * 100)
  
  const getRelevanceColor = (score: number) => {
    if (score >= 0.85) return 'text-green-600 bg-green-50'
    if (score >= 0.75) return 'text-blue-600 bg-blue-50'
    return 'text-gray-600 bg-gray-50'
  }
  
  const exportToCSV = () => {
    const headers = result.data.headers
    const rows = result.data.rows
    
    let csv = headers.map(h => `"${h}"`).join(',') + '\n'
    
    rows.forEach(row => {
      const rowData = row.map(cell => {
        const value = String(cell || '')
        return `"${value.replace(/"/g, '""')}"`
      })
      csv += rowData.join(',') + '\n'
    })
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `${result.fileName}-${result.sheetName}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }
  
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-medium text-gray-500">#{rank}</span>
              <h3 className="text-lg font-medium text-gray-900">{result.fileName}</h3>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getRelevanceColor(result.relevanceScore)}`}>
                {relevancePercentage}% match
              </span>
              {result.extractionInfo?.confidence && (
                <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
                  {Math.round(result.extractionInfo.confidence * 100)}% confidence
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
                Sheet: {result.sheetName}
              </span>
              <span>
                {result.data.totalRowsFound} rows found
              </span>
              {result.extractionInfo?.executionTime && (
                <span className="text-xs text-gray-500">
                  Extracted in {result.extractionInfo.executionTime}ms
                </span>
              )}
            </div>
            
            {/* Extraction Info */}
            {result.extractionInfo && (
              <div className="mt-2 text-sm text-gray-600">
                <span className="font-medium">AI Understanding: </span>
                <span className="italic">{result.extractionInfo.description}</span>
              </div>
            )}
            
            {/* Warnings */}
            {result.extractionInfo?.warnings && result.extractionInfo.warnings.length > 0 && (
              <div className="mt-2">
                {result.extractionInfo.warnings.map((warning, i) => (
                  <div key={i} className="text-sm text-yellow-700 bg-yellow-50 px-2 py-1 rounded">
                    ⚠️ {warning}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRawData(!showRawData)}
              className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1 rounded hover:bg-gray-200 transition-colors"
            >
              {showRawData ? 'Table View' : 'Raw Data'}
            </button>
            <button
              onClick={exportToCSV}
              className="text-sm text-emerald-600 hover:text-emerald-800 px-3 py-1 rounded hover:bg-emerald-50 transition-colors flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      {/* Content */}
      {isExpanded && (
        <div className="p-6">
          {result.data.rows.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No data found matching your search criteria</p>
            </div>
          ) : showRawData ? (
            <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    headers: result.data.headers,
                    rows: result.data.rows.slice(0, 20),
                    ...(result.data.rows.length > 20 && { 
                      note: `Showing first 20 of ${result.data.rows.length} rows` 
                    })
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          ) : (
            <SpreadsheetDataTable
              headers={result.data.headers}
              rows={result.data.rows}
            />
          )}
        </div>
      )}
      
      {/* Drive Link */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
        <a 
          href={`https://drive.google.com/file/d/${result.fileId}/view`}
          target="_blank" 
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Open in Google Drive
        </a>
      </div>
    </div>
  )
}