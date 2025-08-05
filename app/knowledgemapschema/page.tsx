'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { buildDriveKnowledgeMap } from '@/lib/drive-knowledge-builder'
import { DriveKnowledgeMap } from '@/lib/knowledge-map-types'

type ViewMode = 'drive'

export default function KnowledgeMapSchemaPage() {
  const { user } = useAuth()
  const [driveMap, setDriveMap] = useState<DriveKnowledgeMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasGoogleAuth, setHasGoogleAuth] = useState<boolean | null>(null)
  
  // Use auth-helpers client for consistency
  const supabase = createClientComponentClient()

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (user && hasGoogleAuth !== null) {
      loadKnowledgeMaps()
    }
  }, [user, hasGoogleAuth])

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/check', {
        credentials: 'include'
      })
      const data = await res.json()
      setHasGoogleAuth(data.authenticated)
    } catch (error) {
      console.error('Error checking Google auth:', error)
      setHasGoogleAuth(false)
    }
  }

  async function loadKnowledgeMaps() {
    if (!user) return
    
    setLoading(true)
    setError(null)
    
    try {
      const driveResult = await loadDriveKnowledgeMap()
      setDriveMap(driveResult)
    } catch (err) {
      console.error('Error loading knowledge maps:', err)
      setError('Failed to load knowledge maps')
    } finally {
      setLoading(false)
    }
  }

  async function loadDriveKnowledgeMap(): Promise<DriveKnowledgeMap | null> {
    // If not authenticated with Google, return empty map
    if (!hasGoogleAuth) {
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

    // Get user's Drive source
    const { data: source } = await supabase
      .from('data_sources')
      .select('*')
      .eq('user_id', user!.id)
      .eq('type', 'drive')
      .single()
    
    if (!source) {
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
    
    const { data: files, error } = await supabase
      .from('file_metadata')
      .select('*')
      .eq('source_id', source.id)
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
    
    // Get summaries count
    const { data: summaries } = await supabase
      .from('file_summaries')
      .select('file_id')
      .eq('source_id', source.id)
    
    const summaryFileIds = new Set(summaries?.map(s => s.file_id) || [])
    
    // Update files with summary status
    const filesWithSummaryStatus = files.map(file => ({
      ...file,
      metadata: {
        ...file.metadata,
        summary: summaryFileIds.has(file.file_id) ? 'Generated' : undefined,
        summaryStatus: summaryFileIds.has(file.file_id) ? 'success' : undefined
      }
    }))
    
    return buildDriveKnowledgeMap(filesWithSummaryStatus)
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
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-600">Loading knowledge maps...</div>
          </div>
        </div>
      </div>
    )
  }

  if (error && !driveMap) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
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
          <div className="flex items-center gap-4">
            <button
              onClick={() => loadKnowledgeMaps()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm"
            >
              Refresh
            </button>
            {driveMap && hasGoogleAuth && driveMap.totalItems > 0 && (
              <button
                onClick={() => downloadJSON(driveMap, 'drive-knowledge-map.json')}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm"
              >
                Download Drive JSON
              </button>
            )}
          </div>
        </div>

        {/* Note about Database */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-blue-800 text-sm">
            Database schema viewing is temporarily disabled while we implement the new authentication system.
            Only Google Drive schema is available at this time.
          </p>
        </div>

        {/* Drive Schema */}
        <div>
          <h2 className="text-lg font-semibold mb-3 text-green-700">
            Drive Knowledge Map
          </h2>
          {!hasGoogleAuth ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
              <svg className="w-12 h-12 mx-auto text-yellow-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="text-yellow-800">Google Drive not connected. Connect your account to view the Drive schema.</p>
            </div>
          ) : driveMap ? (
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
                <div className="grid grid-cols-4 gap-4 mt-4">
                  <div>
                    <div className="text-lg font-bold text-green-600">
                      {driveMap.statistics.spreadsheets}
                    </div>
                    <div className="text-sm text-gray-600">Spreadsheets</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-blue-600">
                      {driveMap.statistics.documents}
                    </div>
                    <div className="text-sm text-gray-600">Documents</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-purple-600">
                      {driveMap.statistics.filesWithSummaries}
                    </div>
                    <div className="text-sm text-gray-600">With Summaries</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-orange-600">
                      {driveMap.statistics.totalSheets}
                    </div>
                    <div className="text-sm text-gray-600">Total Sheets</div>
                  </div>
                </div>
              </div>
              {driveMap.totalItems > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <pre className="text-xs overflow-auto">
                    {JSON.stringify(driveMap, null, 2)}
                  </pre>
                </div>
              )}
              {driveMap.totalItems === 0 && (
                <div className="bg-gray-100 rounded-lg p-4 text-gray-600 text-center">
                  No Drive data indexed yet. Go to Knowledge Map to index some folders.
                </div>
              )}
            </>
          ) : (
            <div className="bg-gray-100 rounded-lg p-4 text-gray-600">
              No Drive data available
            </div>
          )}
        </div>
      </div>
    </div>
  )
}