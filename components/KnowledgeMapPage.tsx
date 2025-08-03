'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { DataSource, FileMetadata, SchemaMetadata } from '@/lib/supabase'

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
  code: {
    color: '#8b5cf6', // purple
    label: 'Code/Scripts',
    extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'json', 'xml', 'yaml', 'yml', 'html', 'css', 'sql'],
    mimeTypes: [
      'text/javascript',
      'application/javascript',
      'application/json',
      'text/xml',
      'application/xml',
      'text/html',
      'text/css'
    ]
  },
  archive: {
    color: '#f97316', // orange
    label: 'Archives',
    extensions: ['zip', 'tar', 'gz', 'rar', '7z'],
    mimeTypes: [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-tar',
      'application/gzip',
      'application/x-rar-compressed',
      'application/x-7z-compressed'
    ]
  },
  future: {
    color: '#6b7280', // gray
    label: 'Future Implementation',
    extensions: ['pdf', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'mp4', 'avi', 'mov', 'mp3', 'wav'],
    mimeTypes: [
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.google-apps.presentation',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/svg+xml',
      'image/webp',
      'video/mp4',
      'audio/mpeg',
      'audio/wav'
    ]
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
  
  for (const [groupKey, group] of Object.entries(FILE_GROUPS)) {
    if (group.mimeTypes.includes(mimeType) || group.extensions.includes(extension)) {
      return { key: groupKey, ...group }
    }
  }
  
  return { key: 'future', ...FILE_GROUPS.future }
}

export default function KnowledgeMapPage() {
  const [activeTab, setActiveTab] = useState<'sql' | 'drive'>('drive')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [driveToken, setDriveToken] = useState<string | null>(null)
  const [folderUrl, setFolderUrl] = useState('')
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  
  // SQL data
  const [tables, setTables] = useState<Map<string, Set<string>>>(new Map())
  const [sqlSource, setSqlSource] = useState<DataSource | null>(null)
  
  // Drive data
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [driveSource, setDriveSource] = useState<DataSource | null>(null)
  const [folderTree, setFolderTree] = useState<FolderNode[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadData()
    checkAuth()
  }, [])

  useEffect(() => {
    // Build folder tree when files change
    const tree = buildFolderTree(files)
    setFolderTree(tree)
  }, [files])

  async function checkAuth() {
    const res = await fetch('/api/auth/check')
    const data = await res.json()
    if (data.authenticated) {
      setDriveToken(data.token)
    }
  }

  async function loadData() {
    setLoading(true)
    
    // Load data sources
    const { data: sources } = await supabase
      .from('data_sources')
      .select('*')
    
    setSqlSource(sources?.find(s => s.type === 'sql') || null)
    setDriveSource(sources?.find(s => s.type === 'drive') || null)
    
    // Load SQL schema
    const { data: schemas } = await supabase
      .from('schema_metadata')
      .select('*')
    
    const tableMap = new Map<string, Set<string>>()
    schemas?.forEach(schema => {
      if (!tableMap.has(schema.table_name)) {
        tableMap.set(schema.table_name, new Set())
      }
      tableMap.get(schema.table_name)?.add(schema.column_name)
    })
    setTables(tableMap)
    
    // Load Drive files
    const { data: driveFiles } = await supabase
      .from('file_metadata')
      .select('*')
      .order('name')
    
    setFiles(driveFiles || [])
    setLoading(false)
  }

  async function handleResync() {
    if (activeTab === 'drive' && folderTree.length > 0) {
      if (!confirm('Resync all folders with the latest files from Google Drive?')) {
        return
      }
    }
    
    setSyncing(true)
    
    if (activeTab === 'drive' && driveToken) {
      // Resync all root folders
      try {
        for (const folder of folderTree) {
          const response = await fetch('/api/drive/index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderId: folder.id }),
          })
          
          if (!response.ok) {
            console.error(`Failed to resync folder: ${folder.name}`)
          }
        }
      } catch (error) {
        console.error('Error resyncing folders:', error)
      }
    }
    
    await loadData()
    setSyncing(false)
  }

  async function linkGoogleDrive() {
    window.location.href = '/api/auth/google'
  }

  async function indexDriveFolder() {
    if (!folderUrl || !driveToken) return
    
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
        body: JSON.stringify({ folderId }),
      })
      
      const data = await response.json()
      
      if (response.ok) {
        await loadData()
        setFolderUrl('')
        if (data.resynced) {
          alert(`Folder resynced successfully! Updated ${data.indexed} files.`)
        }
      } else {
        alert('Failed to index folder')
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

  async function resyncFolder(folderId: string, folderName: string) {
    if (!confirm(`Resync "${folderName}" with the latest files from Google Drive?`)) {
      return
    }
    
    setSyncing(true)
    
    try {
      const response = await fetch('/api/drive/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      })
      
      const data = await response.json()
      
      if (response.ok) {
        await loadData()
        if (data.resynced) {
          alert(`Folder resynced successfully! Updated ${data.indexed} files.`)
        }
      } else {
        alert('Failed to resync folder')
      }
    } catch (error) {
      alert('Error resyncing folder')
    } finally {
      setSyncing(false)
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
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded"
                  style={{ paddingLeft: `${(level + 1) * 20 + 28}px` }}
                >
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="text-sm text-gray-700">{file.name}</span>
                  <span className="text-xs text-gray-500 ml-auto">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
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
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-semibold">Knowledge Map</h1>
            
            <div className="flex items-center gap-4">
              {activeTab === 'drive' && driveToken && files.length > 0 && (
                <button
                  onClick={clearAllImports}
                  disabled={clearingAll}
                  className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {clearingAll ? 'Clearing...' : 'Clear All Imports'}
                </button>
              )}
              
              {activeTab === 'drive' && !driveToken && (
                <button
                  onClick={linkGoogleDrive}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm transition-colors"
                >
                  Link Google Drive
                </button>
              )}
              
              <button
                onClick={handleResync}
                disabled={syncing}
                className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm transition-colors"
                title={activeTab === 'drive' ? 'Resync all folders with Google Drive' : 'Reload data'}
              >
                {syncing ? 'Syncing...' : activeTab === 'drive' && folderTree.length > 0 ? 'Resync All' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('sql')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sql'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              SQL Database
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
              <div>
                {sqlSource ? (
                  <div>
                    <h2 className="text-lg font-medium mb-4">Database Tables</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {Array.from(tables.entries()).map(([tableName, columns]) => (
                        <div
                          key={tableName}
                          className="bg-white rounded-lg shadow-sm border border-gray-200 p-4"
                        >
                          <h3 className="font-medium text-gray-900 mb-2">{tableName}</h3>
                          <div className="text-sm text-gray-600">
                            <p className="mb-1">{columns.size} columns</p>
                            <p className="text-xs">
                              {Array.from(columns).slice(0, 3).join(', ')}
                              {columns.size > 3 && '...'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    No SQL database connected
                  </div>
                )}
              </div>
            )}

            {/* Drive View */}
            {activeTab === 'drive' && (
              <div>
                {driveToken && (
                  <div className="mb-6 flex gap-2">
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
                )}

                {/* Folder Tree */}
                {(folderTree.length > 0 || files.some(f => !f.metadata?.isFolder)) ? (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h3 className="font-medium text-gray-900 mb-4">Imported Folders</h3>
                    {folderTree.map(node => renderFolderNode(node))}
                    
                    {/* Files not in any folder */}
                    {files.filter(f => !f.metadata?.isFolder && !f.metadata?.parentFolderId).length > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Loose Files</h4>
                        {files.filter(f => !f.metadata?.isFolder && !f.metadata?.parentFolderId).map(file => {
                          const group = getFileGroup(file.mime_type, file.name)
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
                              <span className="text-xs text-gray-500 ml-auto">
                                {(file.size / 1024).toFixed(1)} KB
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    {driveToken ? 'No files indexed yet' : 'Please link your Google Drive'}
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