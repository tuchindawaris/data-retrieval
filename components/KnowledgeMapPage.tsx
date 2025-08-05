'use client'

import { useEffect, useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useAuth } from '@/contexts/AuthContext'
import GoogleAccountStatus from '@/components/GoogleAccountStatus'
import type { DataSource, FileMetadata } from '@/lib/supabase'

// File type groupings for uniform parsing
const FILE_GROUPS = {
  spreadsheet: {
    color: '#10b981', // green
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
    color: '#3b82f6', // blue
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
    color: '#6b7280', // gray
    label: 'Not Supported Yet',
    extensions: [], // All other extensions
    mimeTypes: [] // All other mime types
  }
}

interface FolderNode {
  id: string
  name: string
  path: string
  files: FileMetadata[]
  subfolders: FolderNode[]
  isExpanded: boolean
}

function buildFolderTree(files: FileMetadata[]): FolderNode[] {
  const folderMap = new Map<string, FolderNode>()
  const rootFolders: FolderNode[] = []
  
  // First pass: create all folders
  files.forEach(file => {
    if (file.metadata?.isFolder) {
      const node: FolderNode = {
        id: file.file_id,
        name: file.name,
        path: file.folder_path,
        files: [],
        subfolders: [],
        isExpanded: false
      }
      folderMap.set(file.file_id, node)
    }
  })
  
  // Second pass: build hierarchy and add files
  files.forEach(file => {
    if (file.metadata?.isFolder) {
      const node = folderMap.get(file.file_id)!
      const parentId = file.metadata.parentFolderId
      
      if (parentId && folderMap.has(parentId)) {
        folderMap.get(parentId)!.subfolders.push(node)
      } else {
        rootFolders.push(node)
      }
    } else {
      // Regular file - add to parent folder
      const parentId = file.metadata?.parentFolderId
      if (parentId && folderMap.has(parentId)) {
        folderMap.get(parentId)!.files.push(file)
      }
    }
  })
  
  return rootFolders
}

function getFileGroup(mimeType: string, fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  
  // Check if it's a spreadsheet
  if (FILE_GROUPS.spreadsheet.mimeTypes.includes(mimeType) || 
      FILE_GROUPS.spreadsheet.extensions.includes(extension)) {
    return { key: 'spreadsheet', ...FILE_GROUPS.spreadsheet }
  }
  
  // Check if it's a document
  if (FILE_GROUPS.document.mimeTypes.includes(mimeType) || 
      FILE_GROUPS.document.extensions.includes(extension)) {
    return { key: 'document', ...FILE_GROUPS.document }
  }
  
  // Everything else is unsupported
  return { key: 'unsupported', ...FILE_GROUPS.unsupported }
}

export default function KnowledgeMapPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'sql' | 'drive'>('drive')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [hasGoogleAuth, setHasGoogleAuth] = useState<boolean | null>(null)
  const [folderUrl, setFolderUrl] = useState('')
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [generateSummariesOnIndex, setGenerateSummariesOnIndex] = useState(false)
  
  // Drive data
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [driveSource, setDriveSource] = useState<DataSource | null>(null)
  const [folderTree, setFolderTree] = useState<FolderNode[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [expandedSpreadsheets, setExpandedSpreadsheets] = useState<Set<string>>(new Set())
  const [generatingSummaries, setGeneratingSummaries] = useState(false)
  const [fileSummaries, setFileSummaries] = useState<Map<string, any>>(new Map())
  
  // Use auth-helpers client for consistency
  const supabase = createClientComponentClient()

  useEffect(() => {
    if (user) {
      checkAuth()
    }
  }, [user])

  useEffect(() => {
    if (user && hasGoogleAuth !== null) {
      loadData()
    }
  }, [user, hasGoogleAuth])

  useEffect(() => {
    // Build folder tree when files change
    const tree = buildFolderTree(files)
    setFolderTree(tree)
  }, [files])

  async function checkAuth() {
    const res = await fetch('/api/auth/check', {
      credentials: 'include' // IMPORTANT: Include cookies
    })
    const data = await res.json()
    setHasGoogleAuth(data.authenticated)
  }

  async function loadData() {
    if (!user) return
    
    setLoading(true)
    
    // Only load Drive data if authenticated with Google
    if (!hasGoogleAuth) {
      setDriveSource(null)
      setFiles([])
      setFileSummaries(new Map())
      setLoading(false)
      return
    }
    
    // Get user's Drive source
    const { data: source } = await supabase
      .from('data_sources')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'drive')
      .single()
    
    if (!source) {
      setDriveSource(null)
      setFiles([])
      setLoading(false)
      return
    }
    
    setDriveSource(source)
    
    // Load Drive files
    const { data: driveFiles } = await supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', source.id)
      .order('name')
    
    setFiles(driveFiles || [])
    
    // Load summaries
    const { data: summaries } = await supabase
      .from('file_summaries')
      .select('*')
      .eq('source_id', source.id)
    
    const summaryMap = new Map()
    summaries?.forEach(s => {
      summaryMap.set(s.file_id, s)
    })
    setFileSummaries(summaryMap)
    
    setLoading(false)
  }

  async function handleResync() {
    if (folderTree.length === 0) {
      await loadData()
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
          credentials: 'include', // IMPORTANT: Include cookies
          body: JSON.stringify({ folderId: folder.id }),
        })
        
        if (!response.ok) {
          console.error(`Failed to resync folder: ${folder.name}`)
        }
      }
    } catch (error) {
      console.error('Error resyncing folders:', error)
    }
    
    await loadData()
    setSyncing(false)
  }



  async function indexDriveFolder() {
    if (!folderUrl || !hasGoogleAuth) return
    
    const match = folderUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/)
    const folderId = match ? match[1] : 'root'
    
    // Check if folder already exists locally
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
        credentials: 'include', // IMPORTANT: Include cookies
        body: JSON.stringify({ 
          folderId,
          generateSummaries: generateSummariesOnIndex 
        }),
      })
      
      const data = await response.json()
      
      if (response.ok) {
        await loadData()
        setFolderUrl('')
        
        let message = `Folder indexed successfully!\n`
        message += `- Files indexed: ${data.indexed}\n`
        
        if (generateSummariesOnIndex && data.summariesGenerated !== undefined) {
          message += `- Summaries generated: ${data.summariesGenerated}`
        }
        
        alert(message)
        console.log('Folder indexing complete:', data)
      } else {
        alert(`Failed to index folder: ${data.error || 'Unknown error'}`)
        console.error('Index error:', data)
      }
    } catch (error) {
      alert('Error indexing folder')
      console.error('Error:', error)
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
        credentials: 'include', // IMPORTANT: Include cookies
        body: JSON.stringify({ folderId }),
      })
      
      if (response.ok) {
        await loadData()
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
        credentials: 'include', // IMPORTANT: Include cookies
        body: JSON.stringify({ clearAll: true }),
      })
      
      if (response.ok) {
        await loadData()
      } else {
        alert('Failed to clear imports')
      }
    } catch (error) {
      alert('Error clearing imports')
    } finally {
      setClearingAll(false)
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

  async function resyncFolder(folderId: string, folderName: string) {
    if (!confirm(`Resync "${folderName}" with the latest files from Google Drive?`)) {
      return
    }
    
    setSyncing(true)
    
    try {
      const response = await fetch('/api/drive/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // IMPORTANT: Include cookies
        body: JSON.stringify({ 
          folderId,
          generateSummaries: generateSummariesOnIndex 
        }),
      })
      
      const data = await response.json()
      
      if (response.ok) {
        await loadData()
        
        let message = data.resynced ? 'Folder resynced successfully!\n' : 'Folder indexed successfully!\n'
        message += `- Files updated: ${data.indexed}\n`
        
        if (data.summariesGenerated !== undefined && data.summariesGenerated > 0) {
          message += `- Summaries generated: ${data.summariesGenerated}`
        }
        
        alert(message)
        console.log('Folder operation complete:', data)
      } else {
        alert('Failed to resync folder')
      }
    } catch (error) {
      alert('Error resyncing folder')
    } finally {
      setSyncing(false)
    }
  }

  async function generateSummariesForFiles() {
    if (!confirm('Generate AI summaries for all files? This will use your OpenAI API quota.')) {
      return
    }
    
    setGeneratingSummaries(true)
    console.log('Starting AI summary generation...')
    
    try {
      const response = await fetch('/api/drive/generate-summaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // IMPORTANT: Include cookies
        body: JSON.stringify({}), // Process all files
      })
      
      const data = await response.json()
      
      if (response.ok) {
        await loadData()
        let message = `Successfully generated summaries!\n`
        message += `- Processed: ${data.processed} files\n`
        message += `- Updated: ${data.updated} files\n`
        message += `- Failed: ${data.failed} files\n`
        message += `- Skipped: ${data.skipped} files\n`
        message += `- Tokens used: ${data.tokensUsed || 0}\n`
        message += `- Duration: ${(data.duration / 1000).toFixed(1)}s`
        
        alert(message)
        console.log('Summary generation complete:', data)
      } else {
        alert(`Failed to generate summaries: ${data.error || 'Unknown error'}`)
        console.error('Summary generation failed:', data)
      }
    } catch (error) {
      alert('Error generating summaries')
      console.error('Error:', error)
    } finally {
      setGeneratingSummaries(false)
    }
  }

  function renderFolderNode(node: FolderNode, level: number = 0) {
    const isExpanded = expandedFolders.has(node.id)
    
    return (
      <div key={node.id} className="mb-2">
        <div 
          className="flex items-center gap-2 p-2 hover:bg-gray-100 rounded cursor-pointer"
          style={{ paddingLeft: `${level * 20 + 8}px` }}
        >
          <button 
            onClick={() => toggleFolder(node.id)}
            className="text-gray-500 hover:text-gray-700"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
          
          <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          
          <span className="font-medium flex-1">{node.name}</span>
          
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                resyncFolder(node.id, node.name)
              }}
              disabled={syncing}
              className="text-blue-600 hover:text-blue-800 text-sm px-2 py-1"
            >
              Resync
            </button>
            
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteFolder(node.id)
              }}
              disabled={deletingFolder === node.id}
              className="text-red-600 hover:text-red-800 text-sm px-2 py-1"
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
                    className={`flex items-center gap-2 p-2 hover:bg-gray-50 rounded ${isSpreadsheet ? 'cursor-pointer' : ''}`}
                    style={{ paddingLeft: `${(level + 1) * 20 + 28}px` }}
                    onClick={() => isSpreadsheet && toggleSpreadsheet(file.file_id)}
                  >
                    {isSpreadsheet && (
                      <button className="text-gray-500 hover:text-gray-700 text-xs">
                        {isExpandedSpreadsheet ? '▼' : '▶'}
                      </button>
                    )}
                    <div
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="text-sm text-gray-700">{file.name}</span>
                    {group.key === 'unsupported' && (
                      <span className="text-xs text-gray-500 italic ml-2">(not supported yet)</span>
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
                        <div key={sheetIndex} className="mb-2">
                          <div className="flex items-center gap-2 p-1 text-xs text-gray-600">
                            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                            </svg>
                            <span className="font-medium">{sheet.name}</span>
                            <span className="text-gray-500">
                              ({(sheet.columns?.filter((c: any) => c)?.length || 0)} cols, {sheet.totalRows || 0} rows)
                            </span>
                          </div>
                          
                          {/* Sheet summary from file_summaries table */}
                          {summary?.sheet_summaries?.[sheet.name] && (
                            <div className="ml-6 text-xs text-gray-600 italic">
                              "{summary.sheet_summaries[sheet.name]}"
                            </div>
                          )}
                          
                          {/* Column details */}
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
    <div className="min-h-screen bg-gray-50">
      {/* Google Account Status */}
      <GoogleAccountStatus />

      {/* Secondary Header with Actions */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium">Knowledge Map</h2>
            <div className="flex items-center gap-3">
              {activeTab === 'drive' && hasGoogleAuth && files.length > 0 && (
                <>
                  <button
                    onClick={generateSummariesForFiles}
                    disabled={generatingSummaries}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    {generatingSummaries ? 'Generating...' : 'Generate AI Summaries'}
                  </button>
                  
                  <button
                    onClick={clearAllImports}
                    disabled={clearingAll}
                    className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    {clearingAll ? 'Clearing...' : 'Clear All Imports'}
                  </button>
                </>
              )}
              

              
              <button
                onClick={handleResync}
                disabled={syncing}
                className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm transition-colors"
                title={activeTab === 'drive' ? 'Resync all folders with Google Drive' : 'Reload data'}
              >
                {syncing ? 'Syncing...' : folderTree.length > 0 ? 'Resync All' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              disabled={true}
              className="py-2 px-1 border-b-2 font-medium text-sm border-transparent text-gray-300 cursor-not-allowed"
            >
              SQL Database (Coming Soon)
            </button>
            <button
              onClick={() => setActiveTab('drive')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'drive'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Google Drive
            </button>
          </nav>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-lg text-gray-600">Loading...</div>
          </div>
        ) : (
          <>
            {/* SQL View */}
            {activeTab === 'sql' && (
              <div className="text-center py-12 text-gray-500">
                <div className="mb-4">
                  <svg className="w-16 h-16 mx-auto text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium mb-2">Database Connection Coming Soon</h3>
                <p>Connect to your PostgreSQL, MySQL, or other databases to query with natural language.</p>
              </div>
            )}

            {/* Drive View */}
            {activeTab === 'drive' && (
              <div>
                {hasGoogleAuth && (
                  <div className="mb-6">
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="Google Drive folder URL"
                        value={folderUrl}
                        onChange={(e) => setFolderUrl(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={indexDriveFolder}
                        disabled={!folderUrl || indexing}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md transition-colors"
                      >
                        {indexing ? 'Indexing...' : 'Index Folder'}
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={generateSummariesOnIndex}
                        onChange={(e) => setGenerateSummariesOnIndex(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Generate AI summaries during indexing (uses OpenAI API)
                    </label>
                  </div>
                )}

                {/* Folder Tree */}
                {hasGoogleAuth ? (
                  (folderTree.length > 0 || files.some(f => !f.metadata?.isFolder)) ? (
                    <div>
                      {/* File Type Legend */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">File Type Support</h4>
                        <div className="flex flex-wrap gap-4 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm bg-green-500"></div>
                            <span>Spreadsheets (Supported)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm bg-blue-500"></div>
                            <span>Documents (Supported)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm bg-gray-500"></div>
                            <span>Other Files (Not Supported Yet)</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Folder Tree */}
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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
                                className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded"
                              >
                                <div
                                  className="w-3 h-3 rounded-sm"
                                  style={{ backgroundColor: group.color }}
                                />
                                <span className="text-sm text-gray-700">{file.name}</span>
                                {group.key === 'unsupported' && (
                                  <span className="text-xs text-gray-500 italic ml-2">(not supported yet)</span>
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
                  )
                ) : (
                  <div className="text-center py-12">
                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Google Drive Not Connected</h3>
                    <p className="text-gray-500 mb-4">Connect your Google Drive account to view and manage your files</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}