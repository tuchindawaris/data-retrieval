'use client'

import { useEffect, useState } from 'react'
import ReactFlow, { Node, Edge, Controls, Background } from 'react-flow-renderer'
import { supabase } from '@/lib/supabase'
import type { DataSource, FileMetadata, SchemaMetadata } from '@/lib/supabase'

export default function KnowledgeMap() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [indexing, setIndexing] = useState(false)
  const [driveToken, setDriveToken] = useState<string | null>(null)
  const [folderUrl, setFolderUrl] = useState('')

  useEffect(() => {
    loadKnowledgeMap()
    // Check if we have a token from the server
    fetch('/api/auth/check')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setDriveToken(data.token)
        }
      })
  }, [])

  async function loadKnowledgeMap() {
    setLoading(true)
    
    // Load data sources
    const { data: sources } = await supabase
      .from('data_sources')
      .select('*')
    
    // Load file metadata
    const { data: files } = await supabase
      .from('file_metadata')
      .select('*')
    
    // Load schema metadata
    const { data: schemas } = await supabase
      .from('schema_metadata')
      .select('*')
    
    // Create nodes
    const newNodes: Node[] = []
    const newEdges: Edge[] = []
    
    // Add data source nodes
    sources?.forEach((source, i) => {
      newNodes.push({
        id: source.id,
        type: 'default',
        position: { x: source.type === 'sql' ? 100 : 400, y: 100 },
        data: { 
          label: (
            <div className="p-2 text-center">
              <div className="font-bold">{source.name}</div>
              <div className="text-xs">{source.type.toUpperCase()}</div>
            </div>
          ) 
        },
        style: {
          background: source.type === 'sql' ? '#3b82f6' : '#10b981',
          color: 'white',
          border: '1px solid #1e293b',
          borderRadius: '8px',
          width: 150,
        }
      })
    })
    
    // Add table nodes for SQL sources
    const tables = new Map<string, Set<string>>()
    schemas?.forEach(schema => {
      if (!tables.has(schema.table_name)) {
        tables.set(schema.table_name, new Set())
      }
      tables.get(schema.table_name)?.add(schema.column_name)
    })
    
    let tableY = 250
    tables.forEach((columns, tableName) => {
      const nodeId = `table-${tableName}`
      newNodes.push({
        id: nodeId,
        type: 'default',
        position: { x: 100, y: tableY },
        data: { 
          label: (
            <div className="p-2">
              <div className="font-semibold">{tableName}</div>
              <div className="text-xs mt-1">
                {Array.from(columns).slice(0, 3).join(', ')}
                {columns.size > 3 && '...'}
              </div>
            </div>
          ) 
        },
        style: {
          background: '#e0e7ff',
          border: '1px solid #6366f1',
          borderRadius: '6px',
          fontSize: '12px',
        }
      })
      
      // Add edge from SQL source to table
      const sqlSource = sources?.find(s => s.type === 'sql')
      if (sqlSource) {
        newEdges.push({
          id: `edge-${sqlSource.id}-${nodeId}`,
          source: sqlSource.id,
          target: nodeId,
          type: 'smoothstep',
        })
      }
      
      tableY += 100
    })
    
    // Add file nodes for Drive sources
    let fileY = 250
    files?.forEach(file => {
      newNodes.push({
        id: `file-${file.id}`,
        type: 'default',
        position: { x: 400, y: fileY },
        data: { 
          label: (
            <div className="p-2">
              <div className="font-semibold text-xs">{file.name}</div>
              <div className="text-xs text-gray-600">
                {file.mime_type.split('/')[1] || 'file'}
              </div>
            </div>
          ) 
        },
        style: {
          background: '#d1fae5',
          border: '1px solid #10b981',
          borderRadius: '6px',
          fontSize: '11px',
        }
      })
      
      // Add edge from Drive source to file
      newEdges.push({
        id: `edge-${file.source_id}-file-${file.id}`,
        source: file.source_id,
        target: `file-${file.id}`,
        type: 'smoothstep',
      })
      
      fileY += 80
    })
    
    setNodes(newNodes)
    setEdges(newEdges)
    setLoading(false)
  }

  async function linkGoogleDrive() {
    window.location.href = '/api/auth/google'
  }

  async function indexDriveFolder() {
    if (!folderUrl || !driveToken) return
    
    setIndexing(true)
    
    // Extract folder ID from URL
    const match = folderUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/)
    const folderId = match ? match[1] : 'root'
    
    try {
      const response = await fetch('/api/drive/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      })
      
      if (response.ok) {
        await loadKnowledgeMap()
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
    <div className="h-screen flex flex-col">
      <header className="bg-gray-900 text-white p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold">Knowledge Map</h1>
          <div className="flex gap-4 items-center">
            {!driveToken ? (
              <button
                onClick={linkGoogleDrive}
                className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded transition-colors"
              >
                Link Google Drive
              </button>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Drive folder URL"
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  className="px-3 py-2 rounded text-gray-900 w-96"
                />
                <button
                  onClick={indexDriveFolder}
                  disabled={!folderUrl || indexing}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 px-4 py-2 rounded transition-colors"
                >
                  {indexing ? 'Indexing...' : 'Index Folder'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      
      <main className="flex-1 bg-gray-100">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-lg">Loading knowledge map...</div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            attributionPosition="bottom-left"
          >
            <Background />
            <Controls />
          </ReactFlow>
        )}
      </main>
    </div>
  )
}