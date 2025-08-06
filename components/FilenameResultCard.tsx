// components/FilenameResultCard.tsx

'use client'

import { FilenameSearchResult } from '@/app/api/search/filename/route'

interface FilenameResultCardProps {
  result: FilenameSearchResult
  rank: number
}

export default function FilenameResultCard({ result, rank }: FilenameResultCardProps) {
  const relevancePercentage = Math.round(result.relevanceScore * 100)
  
  // Get relevance color
  const getRelevanceColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600 bg-green-50'
    if (score >= 0.6) return 'text-blue-600 bg-blue-50'
    return 'text-gray-600 bg-gray-50'
  }
  
  // Get file type icon and color based on mime type or extension
  const getFileTypeInfo = (fileName: string, mimeType: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase() || ''
    
    // Images
    if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(extension)) {
      return { icon: '🖼️', color: 'text-purple-600', type: 'Image' }
    }
    
    // Videos
    if (mimeType.startsWith('video/') || ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv'].includes(extension)) {
      return { icon: '🎥', color: 'text-red-600', type: 'Video' }
    }
    
    // Audio
    if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(extension)) {
      return { icon: '🎵', color: 'text-pink-600', type: 'Audio' }
    }
    
    // PDFs
    if (mimeType === 'application/pdf' || extension === 'pdf') {
      return { icon: '📑', color: 'text-red-700', type: 'PDF' }
    }
    
    // Archives
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) {
      return { icon: '📦', color: 'text-yellow-600', type: 'Archive' }
    }
    
    // Presentations
    if (mimeType.includes('presentation') || ['ppt', 'pptx', 'odp'].includes(extension)) {
      return { icon: '📊', color: 'text-orange-600', type: 'Presentation' }
    }
    
    // Code
    if (['js', 'ts', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'jsx', 'tsx', 'json', 'xml', 'yml', 'yaml'].includes(extension)) {
      return { icon: '💻', color: 'text-green-600', type: 'Code' }
    }
    
    // Design files
    if (['psd', 'ai', 'sketch', 'fig', 'xd'].includes(extension)) {
      return { icon: '🎨', color: 'text-indigo-600', type: 'Design' }
    }
    
    // Default
    return { icon: '📄', color: 'text-gray-600', type: 'File' }
  }
  
  const fileInfo = getFileTypeInfo(result.fileName, result.mimeType)
  
  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  
  // Format date
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }
  
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-sm font-medium text-gray-500">#{rank}</span>
              <span className={`text-2xl ${fileInfo.color}`}>{fileInfo.icon}</span>
              <h3 className="text-lg font-medium text-gray-900 truncate max-w-md" title={result.fileName}>
                {result.fileName}
              </h3>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getRelevanceColor(result.relevanceScore)}`}>
                {relevancePercentage}% match
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {fileInfo.type}
              </span>
              <span>{formatFileSize(result.size)}</span>
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {formatDate(result.modifiedTime)}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="px-6 py-4">
        <div className="space-y-2">
          <div className="text-sm">
            <span className="font-medium text-gray-700">Match reason:</span>
            <span className="ml-2 text-gray-600">{result.matchReason}</span>
          </div>
          
          {result.folderPath && result.folderPath !== 'root' && (
            <div className="text-sm">
              <span className="font-medium text-gray-700">Location:</span>
              <span className="ml-2 text-gray-600 font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                {result.folderPath}
              </span>
            </div>
          )}
          
          <div className="text-sm">
            <span className="font-medium text-gray-700">Type:</span>
            <span className="ml-2 text-gray-600 font-mono text-xs">
              {result.mimeType || 'Unknown'}
            </span>
          </div>
        </div>
      </div>
      
      {/* Actions */}
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