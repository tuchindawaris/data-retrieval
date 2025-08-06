// components/SpreadsheetSearch.tsx

'use client'

import { useState } from 'react'
import { SpreadsheetSearchResult } from '@/lib/spreadsheet-search-types'
import SpreadsheetResultCard from './SpreadsheetResultCard'

interface SpreadsheetSearchProps {
  query: string
  setQuery: (query: string) => void
  results: SpreadsheetSearchResult[]
  setResults: (results: SpreadsheetSearchResult[]) => void
  loading: boolean
  setLoading: (loading: boolean) => void
  error: string | null
  setError: (error: string | null) => void
  searchDuration: number | null
  setSearchDuration: (duration: number | null) => void
  matchThreshold: number
  setMatchThreshold: (threshold: number) => void
  maxSheets: number
  setMaxSheets: (max: number) => void
  includeEmptyRows: boolean
  setIncludeEmptyRows: (include: boolean) => void
  searchIntent: any
  setSearchIntent: (intent: any) => void
}

export default function SpreadsheetSearch({
  query,
  setQuery,
  results,
  setResults,
  loading,
  setLoading,
  error,
  setError,
  searchDuration,
  setSearchDuration,
  matchThreshold,
  setMatchThreshold,
  maxSheets,
  setMaxSheets,
  includeEmptyRows,
  setIncludeEmptyRows,
  searchIntent,
  setSearchIntent
}: SpreadsheetSearchProps) {
  const [showSettings, setShowSettings] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    
    setLoading(true)
    setError(null)
    setResults([])
    setSearchIntent(null)
    
    try {
      const response = await fetch('/api/search/spreadsheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          query,
          matchThreshold,
          maxSheets,
          includeEmptyRows
        })
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Search failed')
      }
      
      setResults(data.results)
      setSearchDuration(data.duration)
      setSearchIntent(data.intent)
      
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSearch()
    }
  }

  const totalRowsFound = results.reduce((sum, r) => sum + r.data.rows.length, 0)

  return (
    <div className="max-w-6xl mx-auto">
      {/* Search Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Search your spreadsheets... (e.g., 'payments by vendor name', 'total sales last month', 'find all invoices over $1000')"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Searching...
                </div>
              ) : (
                'Search'
              )}
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              ⚙️ Settings
            </button>
          </div>
        </div>
        
        {/* Search Settings */}
        {showSettings && (
          <div className="border-t pt-3 mt-3 grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Relevance Threshold
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.5"
                  max="0.9"
                  step="0.05"
                  value={matchThreshold}
                  onChange={(e) => setMatchThreshold(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm text-gray-600 w-12">{matchThreshold}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Sheets
              </label>
              <select
                value={maxSheets}
                onChange={(e) => setMaxSheets(parseInt(e.target.value))}
                className="w-full px-3 py-1 border border-gray-300 rounded-md text-sm"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={includeEmptyRows}
                  onChange={(e) => setIncludeEmptyRows(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Include empty rows
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Search Intent Display */}
      {searchIntent && !loading && (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-6">
          <h4 className="font-medium text-blue-900 mb-2">Search Analysis</h4>
          <div className="text-sm text-blue-800">
            <div>
              <span className="font-medium">Type:</span> {searchIntent.type}
            </div>
            {searchIntent.targetColumns?.length > 0 && (
              <div>
                <span className="font-medium">Looking for columns:</span> {searchIntent.targetColumns.join(', ')}
              </div>
            )}
            {searchIntent.filters?.length > 0 && (
              <div>
                <span className="font-medium">Filters:</span> {searchIntent.filters.map((f: any) => 
                  `${f.column} ${f.operator} ${f.value}`
                ).join(', ')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search Summary */}
      {searchDuration !== null && results.length > 0 && (
        <div className="text-sm text-gray-600 mb-4 flex items-center justify-between">
          <span>
            Found {totalRowsFound.toLocaleString()} rows across {results.length} sheets in {searchDuration}ms
          </span>
          <button
            onClick={() => {
              const csvContent = exportAllToCSV(results)
              downloadCSV(csvContent, `spreadsheet-search-${Date.now()}.csv`)
            }}
            className="text-green-600 hover:text-green-700"
          >
            📥 Export All Results
          </button>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-6">
          {results.map((result, index) => (
            <SpreadsheetResultCard 
              key={`${result.fileId}-${result.sheetIndex}`} 
              result={result} 
              rank={index + 1} 
            />
          ))}
        </div>
      )}

      {/* No Results */}
      {!loading && query && results.length === 0 && !error && (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-lg font-medium mb-2">No spreadsheets found</p>
          <p className="text-sm">Try adjusting your search query or lowering the relevance threshold</p>
        </div>
      )}

      {/* Initial State */}
      {!loading && !query && results.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <p className="text-lg font-medium mb-2">Search your spreadsheets</p>
          <p className="text-sm">Find specific data across all your spreadsheet files using natural language</p>
          <div className="mt-4 text-xs text-gray-400">
            <p>Example queries:</p>
            <ul className="mt-2 space-y-1">
              <li>"payments by vendor name"</li>
              <li>"all invoices over $1000"</li>
              <li>"customer emails from sales data"</li>
              <li>"total revenue by month"</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper functions for CSV export
function exportAllToCSV(results: SpreadsheetSearchResult[]): string {
  let csv = 'File,Sheet,Row Number,'
  
  // Get all unique headers
  const allHeaders = new Set<string>()
  results.forEach(r => r.data.headers.forEach(h => allHeaders.add(h)))
  const headers = Array.from(allHeaders)
  csv += headers.join(',') + '\n'
  
  // Add data from each result
  results.forEach(result => {
    result.data.rows.forEach((row, rowIndex) => {
      csv += `"${result.fileName}","${result.sheetName}",${rowIndex + 1},`
      
      const rowData = headers.map(header => {
        const colIndex = result.data.headers.indexOf(header)
        const value = colIndex >= 0 ? row[colIndex] : ''
        return `"${String(value || '').replace(/"/g, '""')}"`
      })
      
      csv += rowData.join(',') + '\n'
    })
  })
  
  return csv
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}