// components/GoogleDriveTab.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import GoogleDriveIndexer from '@/components/GoogleDriveIndexer'
import GoogleDriveSearch from '@/components/GoogleDriveSearch'
import type { DataSource, FileMetadata } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

interface GoogleDriveTabProps {
  user: User | null
  hasGoogleAuth: boolean | null
}

export interface FolderNode {
  id: string
  name: string
  path: string
  files: FileMetadata[]
  subfolders: FolderNode[]
}

export default function GoogleDriveTab({ user, hasGoogleAuth }: GoogleDriveTabProps) {
  const [viewMode, setViewMode] = useState<'indexer' | 'search'>('indexer')
  const [loading, setLoading] = useState(true)
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [driveSource, setDriveSource] = useState<DataSource | null>(null)
  const [folderTree, setFolderTree] = useState<FolderNode[]>([])
  const [fileSummaries, setFileSummaries] = useState<Map<string, any>>(new Map())
  const [embeddingStats, setEmbeddingStats] = useState<{
    totalDocuments: number
    embeddedDocuments: number
  } | null>(null)
  
  const supabase = createClientComponentClient()

  useEffect(() => {
    if (user && hasGoogleAuth !== null) {
      loadData()
    }
  }, [user, hasGoogleAuth])

  useEffect(() => {
    const tree = buildFolderTree(files)
    setFolderTree(tree)
  }, [files])

  async function loadData() {
    if (!user) return
    
    setLoading(true)
    
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
    
    // Load embedding stats
    await loadEmbeddingStats(source.id)
    
    setLoading(false)
  }

  async function loadEmbeddingStats(sourceId: string) {
    const { count: totalDocs } = await supabase
      .from('file_metadata')
      .select('*', { count: 'exact', head: true })
      .eq('source_id', sourceId)
      .or('metadata->isDocument.eq.true,mime_type.in.(text/plain,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.google-apps.document,application/rtf,application/vnd.oasis.opendocument.text)')
    
    const { data: embeddedDocs } = await supabase
      .from('document_embeddings')
      .select('file_id', { count: 'exact' })
      .eq('source_id', sourceId)
    
    const uniqueEmbeddedDocs = new Set(embeddedDocs?.map(d => d.file_id) || [])
    
    setEmbeddingStats({
      totalDocuments: totalDocs || 0,
      embeddedDocuments: uniqueEmbeddedDocs.size
    })
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
          subfolders: []
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
        const parentId = file.metadata?.parentFolderId
        if (parentId && folderMap.has(parentId)) {
          folderMap.get(parentId)!.files.push(file)
        }
      }
    })
    
    return rootFolders
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!hasGoogleAuth) {
    return (
      <div className="text-center py-12">
        <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Google Drive Not Connected</h3>
        <p className="text-gray-500 mb-4">Connect your Google Drive account to view and manage your files</p>
      </div>
    )
  }

  return (
    <div>
      {/* View Mode Toggle */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setViewMode('indexer')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'indexer'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              📁 Manage Files
            </button>
            <button
              onClick={() => setViewMode('search')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'search'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              🔍 Search Files
            </button>
          </div>
          
          {viewMode === 'indexer' && (
            <div className="text-sm text-gray-600">
              {files.length} files indexed
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === 'indexer' ? (
        <GoogleDriveIndexer
          user={user}
          files={files}
          folderTree={folderTree}
          fileSummaries={fileSummaries}
          embeddingStats={embeddingStats}
          driveSource={driveSource}
          onDataChange={loadData}
        />
      ) : (
        <GoogleDriveSearch
          files={files}
          embeddingStats={embeddingStats}
        />
      )}
    </div>
  )
}