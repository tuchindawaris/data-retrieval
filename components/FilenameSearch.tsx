// components/FilenameSearch.tsx

'use client'

import { useState } from 'react'
import { FilenameSearchResult } from '@/app/api/search/filename/route'
import FilenameResultCard from './FilenameResultCard'

interface FilenameSearchProps {
  query: string
  setQuery: (query: string) => void
  results: FilenameSearchResult[]
  setResults: (results: FilenameSearchResult[]) => void
  loading: boolean
  setLoading: (loading: boolean) => void
  error: string | null
  setError: (error: string | null) => void
  searchDuration: number | null
  setSearchDuration: (duration: number | null) => void
  matchThreshold: number
  setMatchThreshold: (threshold: number) => void
  maxResults: number
  setMaxResults: (max: number) => void
}

export default function FilenameSearch({
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
  maxResults,
  setMaxResults
}: FilenameSearchProps) {
  const [showSettings, setShowSettings] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    
    setLoading(true)
    setError(null)
    setResults([])
    
    try {
      const response = await fetch('/api/search/filename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          query,
          matchThreshold,
          maxResults
        })
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Search failed')
      }
      
      setResults(data.results)
      setSearchDuration(data.duration)
      
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

  const totalSize = results.reduce((sum, r) => sum + r.size, 0)

  return (
    <div className="max-w-5xl mx-auto">
      {/* Search Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Search for files by name... (e.g., 'presentation', 'budget report', 'design mockup')"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent resize-none"
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Settings
            </button>
          </div>
        </div>
        
        {/* Search Settings */}
        {showSettings && (
          <div className="border-t pt-3 mt-3 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Relevance Threshold
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.3"
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
                Max Results
              </label>
              <select
                value={maxResults}
                onChange={(e) => setMaxResults(parseInt(e.target.value))}
                className="w-full px-3 py-1 border border-gray-300 rounded-md text-sm"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
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

      {/* Search Summary */}
      {searchDuration !== null && results.length > 0 && (
        <div className="text-sm text-gray-600 mb-4 flex items-center justify-between">
          <span>
            Found {results.length} files ({(totalSize / (1024 * 1024)).toFixed(1)} MB total) in {searchDuration}ms
          </span>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((result, index) => (
            <FilenameResultCard 
              key={result.fileId} 
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
          <p className="text-lg font-medium mb-2">No files found</p>
          <p className="text-sm">Try adjusting your search query or lowering the relevance threshold</p>
        </div>
      )}

      {/* Initial State */}
      {!loading && !query && results.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <p className="text-lg font-medium mb-2">Search unsupported files</p>
          <p className="text-sm">Find images, videos, PDFs, and other files by their names</p>
          <div className="mt-4 text-xs text-gray-400">
            <p>Currently searching file types that are not:</p>
            <ul className="mt-2 space-y-1">
              <li>• Spreadsheets (use Spreadsheet Search)</li>
              <li>• Documents (use Document Search)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}