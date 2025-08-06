'use client'

import { useState } from 'react'
import { SearchResult } from '@/app/api/search/semantic/route'

interface CitationCardProps {
  result: SearchResult
  rank: number
}

export default function CitationCard({ result, rank }: CitationCardProps) {
  const [showContext, setShowContext] = useState(false)
  const [copied, setCopied] = useState(false)
  
  const relevancePercentage = Math.round(result.similarity * 100)
  
  // Get relevance color
  const getRelevanceColor = (similarity: number) => {
    if (similarity >= 0.85) return 'text-green-600 bg-green-50'
    if (similarity >= 0.75) return 'text-blue-600 bg-blue-50'
    return 'text-gray-600 bg-gray-50'
  }
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  const formatCitation = () => {
    const date = result.citation.lastModified 
      ? new Date(result.citation.lastModified).toLocaleDateString()
      : 'n.d.'
    return `${result.citation.documentTitle}. (${date}). ${result.citation.location}. ${result.citation.driveWebLink}`
  }
  
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-sm font-medium text-gray-500">#{rank}</span>
              <h3 className="text-lg font-medium text-gray-900">{result.fileName}</h3>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getRelevanceColor(result.similarity)}`}>
                {relevancePercentage}% match
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {result.citation.location}
              </span>
              <a 
                href={result.citation.driveWebLink} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View in Drive
              </a>
            </div>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="px-6 py-4">
        <div className="prose prose-sm max-w-none">
          {showContext && result.metadata.preceding_context && (
            <span className="text-gray-500 italic">{result.metadata.preceding_context} </span>
          )}
          <span className="text-gray-900">{result.chunkText}</span>
          {showContext && result.metadata.following_context && (
            <span className="text-gray-500 italic"> {result.metadata.following_context}</span>
          )}
        </div>
      </div>
      
      {/* Actions */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowContext(!showContext)}
            className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1 rounded hover:bg-gray-200 transition-colors"
          >
            {showContext ? 'Hide' : 'Show'} Context
          </button>
          <button
            onClick={() => copyToClipboard(result.chunkText)}
            className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1 rounded hover:bg-gray-200 transition-colors"
          >
            Copy Text
          </button>
          <button
            onClick={() => copyToClipboard(formatCitation())}
            className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1 rounded hover:bg-gray-200 transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            Copy Citation
          </button>
        </div>
        {copied && (
          <span className="text-sm text-green-600">Copied!</span>
        )}
      </div>
      
      {/* Metadata (collapsible) */}
      {result.metadata.section_context && (
        <div className="px-6 py-2 bg-blue-50 border-t border-blue-100">
          <p className="text-xs text-blue-700">
            Section: {result.metadata.section_context}
          </p>
        </div>
      )}
    </div>
  )
}