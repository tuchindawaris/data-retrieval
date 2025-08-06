// components/GoogleDriveIndexer.tsx
'use client'

import { useState } from 'react'
import type { DataSource, FileMetadata } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { FolderNode } from './GoogleDriveTab'

interface GoogleDriveIndexerProps {
  user: User | null
  files: FileMetadata[]
  folderTree: FolderNode[]
  fileSummaries: Map<string, any>
  embeddingStats: { totalDocuments: number; embeddedDocuments: number } | null
  driveSource: DataSource | null
  onDataChange: () => Promise<void>
}

const FILE_GROUPS = {
  spreadsheet: {
    color: '#059669', // emerald-600
    label: 'Spreadsheets',
    extensions: ['xlsx', 'xls', 'csv', 'ods'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.oasis.opendocument.spreadsheet'
    ]
  },
  document: {
    color: '#2563eb', // blue-600
    label: 'Documents',
    extensions: ['txt', 'md', 'doc', 'docx', 'rtf', 'odt'],
    mimeTypes: [
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.google-apps.document',
      'application/rtf',
      'application/vnd.oasis.opendocument.text'
    ]
  },
  unsupported: {
    color: '#6b7280', // gray-500
    label: 'Other Files',
    extensions: [],
    mimeTypes: []
  }
}

function getFileGroup(mimeType: string, fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  
  if (FILE_GROUPS.spreadsheet.mimeTypes.includes(mimeType) || 
      FILE_GROUPS.spreadsheet.extensions.includes(extension)) {
    return { key: 'spreadsheet', ...FILE_GROUPS.spreadsheet }
  }
  
  if (FILE_GROUPS.document.mimeTypes.includes(mimeType) || 
      FILE_GROUPS.document.extensions.includes(extension)) {
    return { key: 'document', ...FILE_GROUPS.document }
  }
  
  return { key: 'unsupported', ...FILE_GROUPS.unsupported }
}

export default function GoogleDriveIndexer({
  user,
  files,
  folderTree,
  fileSummaries,
  embeddingStats,
  driveSource,
  onDataChange
}: GoogleDriveIndexerProps) {
  const [folderUrl, setFolderUrl] = useState('')
  const [indexing, setIndexing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [expandedSpreadsheets, setExpandedSpreadsheets] = useState<Set<string>>(new Set())

  async function handleResync() {
    if (folderTree.length === 0) {
      await onDataChange()
      return
    }
    
    if (!confirm('Resync all folders with the latest files from Google Drive?')) {
      return
    }
    
    setSyncing(true)
    
    try {
      for (const folder of folderTree) {
        const response = await fetch('/api/drive/index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ folderId: folder.id }),
        })
        
        if (!response.ok) {
          console.error(`Failed to resync folder: ${folder.name}`)
        }
      }
    } catch (error) {
      console.error('Error resyncing folders:', error)
    }
    
    await onDataChange()
    setSyncing(false)
  }

  async function indexDriveFolder() {
    if (!folderUrl) return
    
    const match = folderUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/)
    const folderId = match ? match[1] : 'root'
    
    const existingFolder = files.find(f => 
      f.file_id === folderId && f.metadata?.isFolder
    )
    
    if (existingFolder) {
      if (!confirm('This folder is already indexed. Would you like to resync it with the latest files from Google Drive?')) {
        return
      }
    }
    
    setIndexing(true)
    
    try {
      const response = await fetch('/api/drive/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folderId }),
      })
      
      const data = await response.json()
      
      if (response.ok) {
        await onDataChange()
        setFolderUrl('')
        
        let message = `Folder indexed successfully!\n`
        message += `- Files indexed: ${data.indexed}\n`
        message += `- Summaries generated: ${data.summariesGenerated || 0}\n`
        message += `- Embeddings generated: ${data.embeddingsGenerated || 0}`
        
        alert(message)
      } else {
        alert(`Failed to index folder: ${data.error || 'Unknown error'}`)
      }
    } catch (error) {
      alert('Error indexing folder')
    } finally {
      setIndexing(false)
    }
  }

  async function deleteFolder(folderId: string) {
    if (!confirm('Are you sure you want to remove this folder and all its contents from the app?')) {
      return
    }
    
    setDeletingFolder(folderId)
    
    try {
      const response = await fetch('/api/drive/index', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folderId }),
      })
      
      if (response.ok) {
        await onDataChange()
      } else {
        alert('Failed to delete folder')
      }
    } catch (error) {
      alert('Error deleting folder')
    } finally {
      setDeletingFolder(null)
    }
  }

  async function clearAllImports() {
    if (!confirm('Are you sure you want to clear ALL imported files? This cannot be undone.')) {
      return
    }
    
    setClearingAll(true)
    
    try {
      const response = await fetch('/api/drive/index', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clearAll: true }),
      })
      
      if (response.ok) {
        await onDataChange()
      } else {
        alert('Failed to clear imports')
      }
    } catch (error) {
      alert('Error clearing imports')
    } finally {
      setClearingAll(false)
    }
  }

  async function resyncFolder(folderId: string, folderName: string) {
    if (!confirm(`Resync "${folderName}" with the latest files from Google Drive?`)) {
      return
    }
    
    setSyncing(true)
    
    try {
      const response = await fetch('/api/drive/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folderId }),
      })
      
      const data = await response.json()
      
      if (response.ok) {
        await onDataChange()
        
        let message = data.resynced ? 'Folder resynced successfully!\n' : 'Folder indexed successfully!\n'
        message += `- Files updated: ${data.indexed}\n`
        message += `- Summaries generated: ${data.summariesGenerated || 0}\n`
        message += `- Embeddings generated: ${data.embeddingsGenerated || 0}`
        
        alert(message)
      } else {
        alert('Failed to resync folder')
      }
    } catch (error) {
      alert('Error resyncing folder')
    } finally {
      setSyncing(false)
    }
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  function toggleSpreadsheet(fileId: string) {
    setExpandedSpreadsheets(prev => {
      const next = new Set(prev)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
  }

  function renderFolderNode(node: FolderNode, level: number = 0) {
    const isExpanded = expandedFolders.has(node.id)
    
    return (
      <div key={node.id} className="mb-1">
        <div 
          className="flex items-center gap-2 py-2 px-2 hover:bg-gray-50 rounded-md cursor-pointer transition-colors"
          style={{ paddingLeft: `${level * 20 + 8}px` }}
        >
          <button 
            onClick={() => toggleFolder(node.id)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
          
          <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          
          <span className="font-medium text-gray-900 flex-1">{node.name}</span>
          
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation()
                resyncFolder(node.id, node.name)
              }}
              disabled={syncing}
              className="text-blue-600 hover:text-blue-700 text-sm px-2 py-1 transition-colors"
            >
              Resync
            </button>
            
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteFolder(node.id)
              }}
              disabled={deletingFolder === node.id}
              className="text-red-600 hover:text-red-700 text-sm px-2 py-1 transition-colors"
            >
              {deletingFolder === node.id ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
        
        {isExpanded && (
          <div>
            {/* Subfolders */}
            {node.subfolders.map(subfolder => renderFolderNode(subfolder, level + 1))}
            
            {/* Files */}
            {node.files.map(file => {
              const group = getFileGroup(file.mime_type, file.name)
              const isSpreadsheet = file.metadata?.isSpreadsheet
              const isExpandedSpreadsheet = expandedSpreadsheets.has(file.file_id)
              const summary = fileSummaries.get(file.file_id)
              
              return (
                <div key={file.id}>
                  <div
                    className={`flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded-md transition-colors ${isSpreadsheet ? 'cursor-pointer' : ''}`}
                    style={{ paddingLeft: `${(level + 1) * 20 + 28}px` }}
                    onClick={() => isSpreadsheet && toggleSpreadsheet(file.file_id)}
                  >
                    {isSpreadsheet && (
                      <button className="text-gray-400 hover:text-gray-600 text-xs transition-colors">
                        {isExpandedSpreadsheet ? '▼' : '▶'}
                      </button>
                    )}
                    <div
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="text-sm text-gray-700">{file.name}</span>
                    {group.key === 'unsupported' && (
                      <span className="text-xs text-gray-500 italic ml-2">(not indexed)</span>
                    )}
                    {isSpreadsheet && file.metadata?.sheets && (
                      <span className="text-xs text-gray-500">
                        ({file.metadata.sheets.length} sheets)
                      </span>
                    )}
                    {summary?.summary && (
                      <span className="text-xs text-gray-600 italic ml-2" title={summary.summary}>
                        "{summary.summary.length > 60 ? summary.summary.substring(0, 60) + '...' : summary.summary}"
                      </span>
                    )}
                    <span className="text-xs text-gray-500 ml-auto">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  
                  {/* Spreadsheet sheets */}
                  {isSpreadsheet && isExpandedSpreadsheet && file.metadata?.sheets && (
                    <div style={{ paddingLeft: `${(level + 2) * 20 + 28}px` }}>
                      {file.metadata.sheets.map((sheet: any, sheetIndex: number) => (
                        <div key={sheetIndex} className="mb-1">
                          <div className="flex items-center gap-2 py-1 text-xs text-gray-600">
                            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                            </svg>
                            <span className="font-medium">{sheet.name}</span>
                            <span className="text-gray-500">
                              ({(sheet.columns?.filter((c: any) => c)?.length || 0)} cols, {sheet.totalRows || 0} rows)
                            </span>
                          </div>
                          
                          {summary?.sheet_summaries?.[sheet.name] && (
                            <div className="ml-6 text-xs text-gray-600 italic">
                              "{summary.sheet_summaries[sheet.name]}"
                            </div>
                          )}
                          
                          {sheet.columns && sheet.columns.length > 0 && (
                            <div className="ml-6 mt-1 text-xs">
                              <div className="grid grid-cols-4 gap-2 text-gray-500">
                                {sheet.columns.filter((col: any) => col).slice(0, 8).map((col: any, colIndex: number) => (
                                  <div key={colIndex} className="truncate">
                                    <span className="font-mono text-gray-400">{col.letter || `Col${colIndex + 1}`}:</span> {col.name || 'Unnamed'}
                                    <span className="text-gray-400"> ({col.dataType || 'unknown'})</span>
                                  </div>
                                ))}
                              </div>
                              {sheet.columns.filter((col: any) => col).length > 8 && (
                                <div className="text-gray-400 mt-1">
                                  ... and {sheet.columns.filter((col: any) => col).length - 8} more columns
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Action Buttons */}
      {files.length > 0 && (
        <div className="flex justify-end gap-3 mb-6">
          <button
            onClick={clearAllImports}
            disabled={clearingAll}
            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {clearingAll ? 'Clearing...' : 'Clear All Imports'}
          </button>
          
          <button
            onClick={handleResync}
            disabled={syncing}
            className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm transition-colors"
          >
            {syncing ? 'Syncing...' : folderTree.length > 0 ? 'Resync All' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Index Folder Form */}
      <div className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Google Drive folder URL"
            value={folderUrl}
            onChange={(e) => setFolderUrl(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={indexDriveFolder}
            disabled={!folderUrl || indexing}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md transition-colors font-medium"
          >
            {indexing ? 'Indexing...' : 'Index Folder'}
          </button>
        </div>
      </div>

      {/* File Browser */}
      {(folderTree.length > 0 || files.some(f => !f.metadata?.isFolder)) ? (
        <div>
          {/* File Type Legend */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
            <h4 className="text-sm font-medium text-gray-900 mb-3">File Type Status</h4>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-emerald-600"></div>
                <span>Spreadsheets (Indexed)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-blue-600"></div>
                <span>Documents (Indexed)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-gray-500"></div>
                <span>Other Files (Not Indexed)</span>
              </div>
            </div>
          </div>
          
          {/* Folder Tree */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 group">
            <h3 className="font-medium text-gray-900 mb-4">Imported Folders</h3>
            {folderTree.map(node => renderFolderNode(node))}
            
            {/* Files not in any folder */}
            {files.filter(f => !f.metadata?.isFolder && !f.metadata?.parentFolderId).length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Loose Files</h4>
                {files.filter(f => !f.metadata?.isFolder && !f.metadata?.parentFolderId).map(file => {
                  const group = getFileGroup(file.mime_type, file.name)
                  const summary = fileSummaries.get(file.file_id)
                  
                  return (
                    <div
                      key={file.id}
                      className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded-md transition-colors"
                    >
                      <div
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: group.color }}
                      />
                      <span className="text-sm text-gray-700">{file.name}</span>
                      {group.key === 'unsupported' && (
                        <span className="text-xs text-gray-500 italic ml-2">(not indexed)</span>
                      )}
                      {summary?.summary && (
                        <span className="text-xs text-gray-600 italic ml-2" title={summary.summary}>
                          "{summary.summary.length > 60 ? summary.summary.substring(0, 60) + '...' : summary.summary}"
                        </span>
                      )}
                      <span className="text-xs text-gray-500 ml-auto">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          No files indexed yet
        </div>
      )}
    </div>
  )
}