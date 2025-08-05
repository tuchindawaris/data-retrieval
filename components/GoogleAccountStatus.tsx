'use client'

import { useEffect, useState } from 'react'

interface GoogleAccountInfo {
  authenticated: boolean
  email?: string
  name?: string
}

export default function GoogleAccountStatus() {
  const [googleAccount, setGoogleAccount] = useState<GoogleAccountInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    checkGoogleAuth()
  }, [])

  async function checkGoogleAuth() {
    try {
      const res = await fetch('/api/auth/check', {
        credentials: 'include'
      })
      const data = await res.json()
      
      setGoogleAccount({
        authenticated: data.authenticated,
        email: data.email,
        name: data.name
      })
    } catch (error) {
      console.error('Error checking Google auth:', error)
      setGoogleAccount({ authenticated: false })
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect your Google Drive account? Your imported files will be hidden but not deleted.')) {
      return
    }

    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/google/logout', {
        method: 'POST',
        credentials: 'include'
      })
      
      if (res.ok) {
        setGoogleAccount({ authenticated: false })
        // Trigger a full page refresh to update all components
        window.location.reload()
      } else {
        alert('Failed to disconnect Google Drive')
      }
    } catch (error) {
      console.error('Error disconnecting:', error)
      alert('Error disconnecting Google Drive')
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleConnect() {
    window.location.href = '/api/auth/google'
  }

  if (loading) {
    return null
  }

  return (
    <div className={`border-b ${googleAccount?.authenticated ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {googleAccount?.authenticated ? (
              <>
                <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="text-green-700 font-medium">Google Drive connected</span>
                {googleAccount.email && (
                  <span className="text-gray-600">• {googleAccount.email}</span>
                )}
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-yellow-700 font-medium">Google Drive not connected</span>
              </>
            )}
          </div>
          
          {googleAccount?.authenticated ? (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={handleConnect}
              className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md font-medium"
            >
              Connect Google Drive
            </button>
          )}
        </div>
      </div>
    </div>
  )
}