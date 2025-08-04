'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { buildDriveKnowledgeMap } from '@/lib/drive-knowledge-builder'
import { buildDatabaseKnowledgeMap } from '@/lib/database-knowledge-builder'
import { DriveKnowledgeMap, DatabaseKnowledgeMap } from '@/lib/knowledge-map-types'

type ViewMode = 'both' | 'drive' | 'database'

export default function KnowledgeMapSchemaPage() {
  const [driveMap, setDriveMap] = useState<DriveKnowledgeMap | null>(null)
  const [databaseMap, setDatabaseMap] = useState<DatabaseKnowledgeMap | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('both')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadKnowledgeMaps()
  }, [])

  async function loadKnowledgeMaps() {
    setLoading(true)
    setError(null)
    
    try {
      // Load both knowledge maps in parallel
      const [driveResult, databaseResult] = await Promise.allSettled([
        loadDriveKnowledgeMap(),
        loadDatabaseKnowledgeMap()
      ])
      
      // Handle Drive result
      if (driveResult.status === 'fulfilled') {
        setDriveMap(driveResult.value)
      } else {
        console.error('Failed to load Drive knowledge map:', driveResult.reason)
      }
      
      // Handle Database result
      if (databaseResult.status === 'fulfilled') {
        setDatabaseMap(databaseResult.value)
      } else {
        console.error('Failed to load Database knowledge map:', databaseResult.reason)
      }
      
      // Set error if both failed
      if (driveResult.status === 'rejected' && databaseResult.status === 'rejected') {
        setError('Failed to load knowledge maps')
      }
    } catch (err) {
      console.error('Error loading knowledge maps:', err)
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function loadDriveKnowledgeMap(): Promise<DriveKnowledgeMap | null> {
    const { data: files, error } = await supabase
      .from('file_metadata')
      .select('*')
      .order('folder_path')
      .order('name')
    
    if (error) {
      console.error('Error loading Drive files:', error)
      return null
    }
    
    if (!files || files.length === 0) {
      return {
        timestamp: new Date().toISOString(),
        source: 'drive',
        totalItems: 0,
        knowledgeTree: [],
        statistics: {
          folders: 0,
          files: 0,
          spreadsheets: 0,
          documents: 0,
          processedSpreadsheets: 0,
          filesWithSummaries: 0,
          filesWithFailedSummaries: 0,
          totalSheets: 0,
          totalColumns: 0,
          totalSize: 0
        }
      }
    }
    
    return buildDriveKnowledgeMap(files)
  }

  async function loadDatabaseKnowledgeMap(): Promise<DatabaseKnowledgeMap | null> {
    const { data: schemas, error } = await supabase
      .from('schema_metadata')
      .select('*')
      .order('table_name')
      .order('column_name')
    
    if (error) {
      console.error('Error loading Database schemas:', error)
      return null
    }
    
    if (!schemas || schemas.length === 0) {
      return {
        timestamp: new Date().toISOString(),
        source: 'database',
        totalItems: 0,
        knowledgeTree: [],
        statistics: {
          schemas: 0,
          tables: 0,
          views: 0,
          totalColumns: 0,
          columnsWithDefaults: 0,
          tablesWithPrimaryKeys: 0,
          tablesWithIndexes: 0,
          foreignKeyRelationships: 0,
          nullableColumns: 0,
          nonNullableColumns: 0
        }
      }
    }
    
    return buildDatabaseKnowledgeMap(schemas)
  }

  function downloadJSON(data: any, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Knowledge Map Schema</h1>
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-600">Loading knowledge maps...</div>
          </div>
        </div>
      </div>
    )
  }

  if (error && !driveMap && !databaseMap) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Knowledge Map Schema</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Knowledge Map Schema</h1>
          <div className="flex gap-2">
            <button
              onClick={() => loadKnowledgeMaps()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm"
            >
              Refresh
            </button>
            {driveMap && (
              <button
                onClick={() => downloadJSON(driveMap, 'drive-knowledge-map.json')}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm"
              >
                Download Drive JSON
              </button>
            )}
            {databaseMap && (
              <button
                onClick={() => downloadJSON(databaseMap, 'database-knowledge-map.json')}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md text-sm"
              >
                Download Database JSON
              </button>
            )}
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setViewMode('both')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                viewMode === 'both'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Both
            </button>
            <button
              onClick={() => setViewMode('drive')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                viewMode === 'drive'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Drive Only
            </button>
            <button
              onClick={() => setViewMode('database')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                viewMode === 'database'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Database Only
            </button>
          </nav>
        </div>

        {/* Content based on view mode */}
        {viewMode === 'both' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Drive Schema */}
            <div>
              <h2 className="text-lg font-semibold mb-3 text-green-700">
                Drive Knowledge Map
              </h2>
              {driveMap ? (
                <>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-3">
                    <h3 className="font-medium mb-2">Statistics</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Folders: {driveMap.statistics.folders}</div>
                      <div>Files: {driveMap.statistics.files}</div>
                      <div>Spreadsheets: {driveMap.statistics.spreadsheets}</div>
                      <div>Documents: {driveMap.statistics.documents}</div>
                      <div>Total Sheets: {driveMap.statistics.totalSheets}</div>
                      <div>Total Columns: {driveMap.statistics.totalColumns}</div>
                      <div>With Summaries: {driveMap.statistics.filesWithSummaries}</div>
                      <div>Size: {(driveMap.statistics.totalSize / (1024 * 1024)).toFixed(2)} MB</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <pre className="text-xs overflow-auto max-h-[600px]">
                      {JSON.stringify(driveMap, null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="bg-gray-100 rounded-lg p-4 text-gray-600">
                  No Drive data available
                </div>
              )}
            </div>

            {/* Database Schema */}
            <div>
              <h2 className="text-lg font-semibold mb-3 text-purple-700">
                Database Knowledge Map
              </h2>
              {databaseMap ? (
                <>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-3">
                    <h3 className="font-medium mb-2">Statistics</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Schemas: {databaseMap.statistics.schemas}</div>
                      <div>Tables: {databaseMap.statistics.tables}</div>
                      <div>Views: {databaseMap.statistics.views}</div>
                      <div>Total Columns: {databaseMap.statistics.totalColumns}</div>
                      <div>With Defaults: {databaseMap.statistics.columnsWithDefaults}</div>
                      <div>Nullable: {databaseMap.statistics.nullableColumns}</div>
                      <div>With Primary Keys: {databaseMap.statistics.tablesWithPrimaryKeys}</div>
                      <div>Foreign Keys: {databaseMap.statistics.foreignKeyRelationships}</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <pre className="text-xs overflow-auto max-h-[600px]">
                      {JSON.stringify(databaseMap, null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="bg-gray-100 rounded-lg p-4 text-gray-600">
                  No Database schema available
                </div>
              )}
            </div>
          </div>
        )}

        {viewMode === 'drive' && (
          <div>
            {driveMap ? (
              <>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
                  <h3 className="font-medium mb-3">Drive Statistics</h3>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <div className="text-2xl font-bold text-green-600">
                        {driveMap.statistics.folders}
                      </div>
                      <div className="text-sm text-gray-600">Folders</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-blue-600">
                        {driveMap.statistics.files}
                      </div>
                      <div className="text-sm text-gray-600">Files</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-purple-600">
                        {driveMap.statistics.totalColumns}
                      </div>
                      <div className="text-sm text-gray-600">Total Columns</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-orange-600">
                        {(driveMap.statistics.totalSize / (1024 * 1024)).toFixed(2)} MB
                      </div>
                      <div className="text-sm text-gray-600">Total Size</div>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <pre className="text-xs overflow-auto">
                    {JSON.stringify(driveMap, null, 2)}
                  </pre>
                </div>
              </>
            ) : (
              <div className="bg-gray-100 rounded-lg p-4 text-gray-600">
                No Drive data available
              </div>
            )}
          </div>
        )}

        {viewMode === 'database' && (
          <div>
            {databaseMap ? (
              <>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
                  <h3 className="font-medium mb-3">Database Statistics</h3>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <div className="text-2xl font-bold text-purple-600">
                        {databaseMap.statistics.tables}
                      </div>
                      <div className="text-sm text-gray-600">Tables</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-blue-600">
                        {databaseMap.statistics.totalColumns}
                      </div>
                      <div className="text-sm text-gray-600">Columns</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600">
                        {databaseMap.statistics.tablesWithPrimaryKeys}
                      </div>
                      <div className="text-sm text-gray-600">With Primary Keys</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-orange-600">
                        {databaseMap.statistics.foreignKeyRelationships}
                      </div>
                      <div className="text-sm text-gray-600">Foreign Keys</div>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <pre className="text-xs overflow-auto">
                    {JSON.stringify(databaseMap, null, 2)}
                  </pre>
                </div>
              </>
            ) : (
              <div className="bg-gray-100 rounded-lg p-4 text-gray-600">
                No Database schema available
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}