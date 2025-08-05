'use client'

import { useAuth } from '@/contexts/AuthContext'
import Navbar from '@/components/Navbar'
import { usePathname } from 'next/navigation'

export default function AuthenticatedLayout({
  children
}: {
  children: React.ReactNode
}) {
  const { user, loading } = useAuth()
  const pathname = usePathname()
  
  // Don't show navbar on auth pages
  const authPages = ['/login', '/signup']
  const isAuthPage = authPages.includes(pathname)
  
  // Show navbar only for authenticated users on non-auth pages
  const shouldShowNavbar = user && !isAuthPage && !loading
  
  return (
    <>
      {shouldShowNavbar && <Navbar />}
      {children}
    </>
  )
}