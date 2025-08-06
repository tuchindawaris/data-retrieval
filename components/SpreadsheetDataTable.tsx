// components/SpreadsheetDataTable.tsx

'use client'

import { useState, useMemo } from 'react'

interface SpreadsheetDataTableProps {
  headers: string[]
  rows: any[][]
  matchedColumns?: number[]
}

export default function SpreadsheetDataTable({ 
  headers, 
  rows, 
  matchedColumns = [] 
}: SpreadsheetDataTableProps) {
  const [sortColumn, setSortColumn] = useState<number | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filterValues, setFilterValues] = useState<Record<number, string>>({})
  const [currentPage, setCurrentPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [showFilters, setShowFilters] = useState(false)
  
  // Apply filters and sorting
  const processedRows = useMemo(() => {
    let filtered = rows
    
    // Apply filters
    Object.entries(filterValues).forEach(([colIndex, filterValue]) => {
      if (filterValue.trim()) {
        filtered = filtered.filter(row => {
          const cellValue = String(row[parseInt(colIndex)] || '').toLowerCase()
          return cellValue.includes(filterValue.toLowerCase())
        })
      }
    })
    
    // Apply sorting
    if (sortColumn !== null) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[sortColumn]
        const bVal = b[sortColumn]
        
        // Handle null/undefined
        if (aVal == null && bVal == null) return 0
        if (aVal == null) return sortDirection === 'asc' ? 1 : -1
        if (bVal == null) return sortDirection === 'asc' ? -1 : 1
        
        // Try numeric comparison first
        const aNum = parseFloat(String(aVal).replace(/[$,]/g, ''))
        const bNum = parseFloat(String(bVal).replace(/[$,]/g, ''))
        
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
        }
        
        // Fall back to string comparison
        const aStr = String(aVal).toLowerCase()
        const bStr = String(bVal).toLowerCase()
        
        if (sortDirection === 'asc') {
          return aStr < bStr ? -1 : aStr > bStr ? 1 : 0
        } else {
          return aStr > bStr ? -1 : aStr < bStr ? 1 : 0
        }
      })
    }
    
    return filtered
  }, [rows, filterValues, sortColumn, sortDirection])
  
  // Pagination
  const totalPages = Math.ceil(processedRows.length / rowsPerPage)
  const paginatedRows = processedRows.slice(
    currentPage * rowsPerPage,
    (currentPage + 1) * rowsPerPage
  )
  
  const handleSort = (colIndex: number) => {
    if (sortColumn === colIndex) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(colIndex)
      setSortDirection('asc')
    }
  }
  
  const handleFilterChange = (colIndex: number, value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [colIndex]: value
    }))
    setCurrentPage(0) // Reset to first page when filtering
  }
  
  const clearFilters = () => {
    setFilterValues({})
    setCurrentPage(0)
  }
  
  const getColumnStats = (colIndex: number) => {
    const values = rows.map(r => r[colIndex]).filter(v => v != null && v !== '')
    const uniqueValues = new Set(values)
    
    // Check if numeric
    const numbers = values
      .map(v => parseFloat(String(v).replace(/[$,]/g, '')))
      .filter(n => !isNaN(n))
    
    if (numbers.length > values.length * 0.5) {
      const min = Math.min(...numbers)
      const max = Math.max(...numbers)
      const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length
      
      return {
        type: 'numeric',
        min,
        max,
        avg,
        unique: uniqueValues.size
      }
    }
    
    return {
      type: 'text',
      unique: uniqueValues.size,
      maxLength: Math.max(...values.map(v => String(v).length))
    }
  }
  
  return (
    <div>
      {/* Table Controls */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`text-sm px-3 py-1 rounded transition-colors ${
              showFilters 
                ? 'bg-blue-100 text-blue-700' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            🔽 Filters {Object.keys(filterValues).length > 0 && `(${Object.keys(filterValues).length})`}
          </button>
          
          {Object.keys(filterValues).length > 0 && (
            <button
              onClick={clearFilters}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Clear filters
            </button>
          )}
          
          <span className="text-sm text-gray-600">
            Showing {paginatedRows.length} of {processedRows.length} rows
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Rows per page:</label>
          <select
            value={rowsPerPage}
            onChange={(e) => {
              setRowsPerPage(parseInt(e.target.value))
              setCurrentPage(0)
            }}
            className="text-sm border border-gray-300 rounded px-2 py-1"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>
      
      {/* Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Row
              </th>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className={`px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 ${
                    matchedColumns.includes(i) ? 'bg-green-50' : ''
                  }`}
                  onClick={() => handleSort(i)}
                >
                  <div className="flex items-center gap-1">
                    <span>{header}</span>
                    {sortColumn === i && (
                      <span className="text-blue-600">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                    {matchedColumns.includes(i) && (
                      <span className="text-green-600" title="Matched column">✓</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
            
            {/* Filter Row */}
            {showFilters && (
              <tr className="bg-blue-50">
                <td className="px-3 py-2"></td>
                {headers.map((_, i) => (
                  <td key={i} className="px-3 py-2">
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={filterValues[i] || ''}
                      onChange={(e) => handleFilterChange(i, e.target.value)}
                      className="w-full text-xs px-2 py-1 border border-gray-300 rounded"
                    />
                  </td>
                ))}
              </tr>
            )}
          </thead>
          
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedRows.length === 0 ? (
              <tr>
                <td 
                  colSpan={headers.length + 1} 
                  className="px-6 py-4 text-center text-gray-500"
                >
                  No data matches the current filters
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                    {currentPage * rowsPerPage + rowIndex + 1}
                  </td>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={`px-3 py-2 text-sm text-gray-900 ${
                        matchedColumns.includes(cellIndex) ? 'bg-green-50 font-medium' : ''
                      }`}
                    >
                      <div className="max-w-xs truncate" title={String(cell || '')}>
                        {formatCellValue(cell)}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(0)}
              disabled={currentPage === 0}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 0}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
          </div>
          
          <span className="text-sm text-gray-600">
            Page {currentPage + 1} of {totalPages}
          </span>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === totalPages - 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(totalPages - 1)}
              disabled={currentPage === totalPages - 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Format cell values for display
function formatCellValue(value: any): string {
  if (value == null || value === '') return ''
  
  // Check if it's a number with currency symbols
  const strValue = String(value)
  if (strValue.includes('$') || /^\d+\.?\d*$/.test(strValue.replace(/[,$]/g, ''))) {
    const num = parseFloat(strValue.replace(/[,$]/g, ''))
    if (!isNaN(num)) {
      // Format as currency if it had a $ sign
      if (strValue.includes('$')) {
        return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      }
      // Format as number with commas
      return num.toLocaleString('en-US')
    }
  }
  
  // Check if it's a date
  const dateVal = Date.parse(strValue)
  if (!isNaN(dateVal) && strValue.match(/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/)) {
    return new Date(dateVal).toLocaleDateString()
  }
  
  return strValue
}