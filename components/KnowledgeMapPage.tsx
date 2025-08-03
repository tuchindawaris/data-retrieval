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
  
  // SQL data
  const [tables, setTables] = useState<Map<string, Set<string>>>(new Map())
  const [sqlSource, setSqlSource] = useState<DataSource | null>(null)
  
  // Drive data
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [driveSource, setDriveSource] = useState<DataSource | null>(null)
  const [groupedFiles, setGroupedFiles] = useState<Record<string, FileMetadata[]>>({})

  useEffect(() => {
    loadData()
    checkAuth()
  }, [])

  useEffect(() => {
    // Group files when they change
    const grouped: Record<string, FileMetadata[]> = {}
    files.forEach(file => {
      const group = getFileGroup(file.mime_type, file.name)
      if (!grouped[group.key]) {
        grouped[group.key] = []
      }
      grouped[group.key].push(file)
    })
    setGroupedFiles(grouped)
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
    setSyncing(true)
    await loadData()
    setSyncing(false)
  }

  async function linkGoogleDrive() {
    window.location.href = '/api/auth/google'
  }

  async function indexDriveFolder() {
    if (!folderUrl || !driveToken) return
    
    setIndexing(true)
    
    const match = folderUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/)
    const folderId = match ? match[1] : 'root'
    
    try {
      const response = await fetch('/api/drive/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      })
      
      if (response.ok) {
        await loadData()
        setFolderUrl('')
      } else {
        alert('Failed to index folder')
      }
    } catch (error) {
      alert('Error indexing folder')
    } finally {
      setIndexing(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-semibold">Knowledge Map</h1>
            
            <div className="flex items-center gap-4">
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
              >
                {syncing ? 'Syncing...' : 'Resync'}
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

                {/* File Groups */}
                {Object.entries(FILE_GROUPS).map(([groupKey, group]) => {
                  const groupFiles = groupedFiles[groupKey] || []
                  if (groupFiles.length === 0) return null

                  return (
                    <div key={groupKey} className="mb-8">
                      <div className="flex items-center mb-3">
                        <div
                          className="w-4 h-4 rounded mr-2"
                          style={{ backgroundColor: group.color }}
                        />
                        <h3 className="font-medium text-gray-900">
                          {group.label} ({groupFiles.length})
                        </h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {groupFiles.map(file => (
                          <div
                            key={file.id}
                            className="bg-white rounded-lg shadow-sm border p-3"
                            style={{ borderColor: group.color }}
                          >
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {file.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {(file.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}

                {files.length === 0 && (
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