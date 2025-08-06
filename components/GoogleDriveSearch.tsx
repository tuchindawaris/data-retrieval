// components/GoogleDriveSearch.tsx
'use client'

import { useState } from 'react'
import SemanticSearch from '@/components/SemanticSearch'
import SpreadsheetSearch from '@/components/SpreadsheetSearch'
import FilenameSearch from '@/components/FilenameSearch'
import type { FileMetadata } from '@/lib/supabase'
import type { SearchResult } from '@/app/api/search/semantic/route'
import type { SpreadsheetSearchResult } from '@/lib/spreadsheet-search-types'
import type { FilenameSearchResult } from '@/app/api/search/filename/route'

interface GoogleDriveSearchProps {
  files: FileMetadata[]
  embeddingStats: { totalDocuments: number; embeddedDocuments: number } | null
}

export default function GoogleDriveSearch({ files, embeddingStats }: GoogleDriveSearchProps) {
  const [searchType, setSearchType] = useState<'documents' | 'spreadsheets' | 'files'>('documents')
  
  // Semantic Search states
  const [semanticQuery, setSemanticQuery] = useState('')
  const [semanticResults, setSemanticResults] = useState<SearchResult[]>([])
  const [semanticLoading, setSemanticLoading] = useState(false)
  const [semanticError, setSemanticError] = useState<string | null>(null)
  const [semanticDuration, setSemanticDuration] = useState<number | null>(null)
  const [semanticThreshold, setSemanticThreshold] = useState(0.2)
  const [semanticMatchCount, setSemanticMatchCount] = useState(10)
  
  // Spreadsheet Search states
  const [spreadsheetQuery, setSpreadsheetQuery] = useState('')
  const [spreadsheetResults, setSpreadsheetResults] = useState<SpreadsheetSearchResult[]>([])
  const [spreadsheetLoading, setSpreadsheetLoading] = useState(false)
  const [spreadsheetError, setSpreadsheetError] = useState<string | null>(null)
  const [spreadsheetDuration, setSpreadsheetDuration] = useState<number | null>(null)
  const [spreadsheetThreshold, setSpreadsheetThreshold] = useState(0.7)
  const [spreadsheetMaxSheets, setSpreadsheetMaxSheets] = useState(10)
  const [spreadsheetIncludeEmpty, setSpreadsheetIncludeEmpty] = useState(false)
  const [spreadsheetIntent, setSpreadsheetIntent] = useState<any>(null)
  
  // File Search states
  const [filenameQuery, setFilenameQuery] = useState('')
  const [filenameResults, setFilenameResults] = useState<FilenameSearchResult[]>([])
  const [filenameLoading, setFilenameLoading] = useState(false)
  const [filenameError, setFilenameError] = useState<string | null>(null)
  const [filenameDuration, setFilenameDuration] = useState<number | null>(null)
  const [filenameThreshold, setFilenameThreshold] = useState(0.5)
  const [filenameMaxResults, setFilenameMaxResults] = useState(20)

  const hasSpreadsheets = files.some(f => f.metadata?.isSpreadsheet)
  const hasOtherFiles = files.some(f => !f.metadata?.isSpreadsheet && !f.metadata?.isDocument && !f.metadata?.isFolder)
  const hasEmbeddings = embeddingStats && embeddingStats.embeddedDocuments > 0

  return (
    <div>
      {/* Search Type Tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => setSearchType('documents')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                searchType === 'documents'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Search Documents
            </button>
            <button
              onClick={() => setSearchType('spreadsheets')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                searchType === 'spreadsheets'
                  ? 'border-emerald-500 text-emerald-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Search Spreadsheets
            </button>
            <button
              onClick={() => setSearchType('files')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                searchType === 'files'
                  ? 'border-gray-700 text-gray-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Search Other Files
            </button>
          </nav>
        </div>
      </div>

      {/* Search Content */}
      {searchType === 'documents' && (
        hasEmbeddings ? (
          <SemanticSearch 
            query={semanticQuery}
            setQuery={setSemanticQuery}
            results={semanticResults}
            setResults={setSemanticResults}
            loading={semanticLoading}
            setLoading={setSemanticLoading}
            error={semanticError}
            setError={setSemanticError}
            searchDuration={semanticDuration}
            setSearchDuration={setSemanticDuration}
            matchThreshold={semanticThreshold}
            setMatchThreshold={setSemanticThreshold}
            matchCount={semanticMatchCount}
            setMatchCount={setSemanticMatchCount}
          />
        ) : (
          <div className="text-center py-12">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Document Embeddings Yet</h3>
            <p className="text-gray-500 mb-4">Documents are automatically indexed when you add folders</p>
            <p className="text-sm text-gray-400">Go back to file management to index documents</p>
          </div>
        )
      )}

      {searchType === 'spreadsheets' && (
        hasSpreadsheets ? (
          <SpreadsheetSearch 
            query={spreadsheetQuery}
            setQuery={setSpreadsheetQuery}
            results={spreadsheetResults}
            setResults={setSpreadsheetResults}
            loading={spreadsheetLoading}
            setLoading={setSpreadsheetLoading}
            error={spreadsheetError}
            setError={setSpreadsheetError}
            searchDuration={spreadsheetDuration}
            setSearchDuration={setSpreadsheetDuration}
            matchThreshold={spreadsheetThreshold}
            setMatchThreshold={setSpreadsheetThreshold}
            maxSheets={spreadsheetMaxSheets}
            setMaxSheets={setSpreadsheetMaxSheets}
            includeEmptyRows={spreadsheetIncludeEmpty}
            setIncludeEmptyRows={setSpreadsheetIncludeEmpty}
            searchIntent={spreadsheetIntent}
            setSearchIntent={setSpreadsheetIntent}
          />
        ) : (
          <div className="text-center py-12">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Spreadsheets Found</h3>
            <p className="text-gray-500 mb-4">Index some folders containing spreadsheets to enable search</p>
            <p className="text-sm text-gray-400">Go back to file management to index spreadsheets</p>
          </div>
        )
      )}

      {searchType === 'files' && (
        hasOtherFiles ? (
          <FilenameSearch 
            query={filenameQuery}
            setQuery={setFilenameQuery}
            results={filenameResults}
            setResults={setFilenameResults}
            loading={filenameLoading}
            setLoading={setFilenameLoading}
            error={filenameError}
            setError={setFilenameError}
            searchDuration={filenameDuration}
            setSearchDuration={setFilenameDuration}
            matchThreshold={filenameThreshold}
            setMatchThreshold={setFilenameThreshold}
            maxResults={filenameMaxResults}
            setMaxResults={setFilenameMaxResults}
          />
        ) : (
          <div className="text-center py-12">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Other Files Found</h3>
            <p className="text-gray-500 mb-4">Index some folders containing images, PDFs, or other files to enable search</p>
            <p className="text-sm text-gray-400">Go back to file management to index files</p>
          </div>
        )
      )}
    </div>
  )
}