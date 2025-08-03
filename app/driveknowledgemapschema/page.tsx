// Note: This file should be placed at app/driveknowledgemapschema/page.tsx
// to make the route available at /driveknowledgemapschema

'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { FileMetadata } from '@/lib/supabase'

export default function DriveKnowledgeMapSchemaPage() {
  const [knowledgeMap, setKnowledgeMap] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadKnowledgeMap()
  }, [])

  async function loadKnowledgeMap() {
    setLoading(true)
    
    // Load all Drive files
    const { data: files, error } = await supabase
      .from('file_metadata')
      .select('*')
      .order('folder_path')
      .order('name')
    
    if (error) {
      console.error('Error loading files:', error)
      setKnowledgeMap({ error: error.message })
      setLoading(false)
      return
    }

    // Build hierarchical structure
    const filesByPath = new Map<string, FileMetadata[]>()
    const folderMap = new Map<string, FileMetadata>()
    
    // First pass: organize files and identify folders
    files?.forEach(file => {
      if (file.metadata?.isFolder) {
        folderMap.set(file.file_id, file)
      }
      
      const path = file.metadata?.parentFolderId || 'root'
      if (!filesByPath.has(path)) {
        filesByPath.set(path, [])
      }
      filesByPath.get(path)!.push(file)
    })

    // Build tree structure
    function buildNode(file: FileMetadata): any {
      const node: any = {
        id: file.file_id,
        name: file.name,
        type: file.mime_type,
        size: file.size,
        path: file.folder_path,
        metadata: file.metadata
      }

      // If it's a folder, add children
      if (file.metadata?.isFolder) {
        const children = filesByPath.get(file.file_id) || []
        node.children = children.map(child => buildNode(child))
      }

      // If it's a spreadsheet, include sheet details
      if (file.metadata?.isSpreadsheet && file.metadata?.sheets) {
        node.sheets = file.metadata.sheets
      }

      return node
    }

    // Build from root folders
    const rootFiles = filesByPath.get('root') || []
    const tree = rootFiles.map(file => buildNode(file))

    const result = {
      timestamp: new Date().toISOString(),
      totalFiles: files?.length || 0,
      knowledgeTree: tree,
      statistics: {
        folders: files?.filter(f => f.metadata?.isFolder).length || 0,
        spreadsheets: files?.filter(f => f.metadata?.isSpreadsheet).length || 0,
        processedSpreadsheets: files?.filter(f => f.metadata?.sheets).length || 0,
        documents: files?.filter(f => f.metadata?.isDocument).length || 0,
        filesWithSummaries: files?.filter(f => f.metadata?.summary).length || 0,
        filesWithFailedSummaries: files?.filter(f => f.metadata?.summaryStatus === 'failed').length || 0,
        totalSheets: files?.reduce((sum, f) => sum + (f.metadata?.sheets?.length || 0), 0) || 0,
        totalColumns: files?.reduce((sum, f) => 
          sum + (f.metadata?.sheets?.reduce((sheetSum: number, sheet: any) => 
            sheetSum + (sheet.columns?.length || 0), 0) || 0), 0) || 0
      }
    }

    setKnowledgeMap(result)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Drive Knowledge Map Schema</h1>
          <div className="text-gray-600">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Drive Knowledge Map Schema</h1>
          <button
            onClick={() => loadKnowledgeMap()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm"
          >
            Refresh
          </button>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <pre className="text-xs overflow-auto">
            {JSON.stringify(knowledgeMap, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}