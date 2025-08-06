// components/KnowledgeMapPage.tsx
'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import GoogleAccountStatus from '@/components/GoogleAccountStatus'
import GoogleDriveTab from '@/components/GoogleDriveTab'

export default function KnowledgeMapPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'sql' | 'drive'>('drive')
  const [hasGoogleAuth, setHasGoogleAuth] = useState<boolean | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    // Only check auth if we haven't checked yet OR if user ID changed
    if (user && (!authChecked || user.id !== userId)) {
      checkAuth()
      setAuthChecked(true)
      setUserId(user.id)
    }
  }, [user])

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Google Account Status Bar */}
      <GoogleAccountStatus />

      {/* Main Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h2 className="text-xl font-semibold text-gray-900">Knowledge Map</h2>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Main Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              disabled={true}
              className="py-2 px-1 border-b-2 font-medium text-sm border-transparent text-gray-300 cursor-not-allowed"
            >
              SQL Database
              <span className="ml-2 text-xs">(Coming Soon)</span>
            </button>
            <button
              onClick={() => setActiveTab('drive')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'drive'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Google Drive
            </button>
          </nav>
        </div>

        {/* Tab Content */}
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

        {activeTab === 'drive' && (
          <GoogleDriveTab 
            user={user}
            hasGoogleAuth={hasGoogleAuth}
          />
        )}
      </div>
    </div>
  )
}