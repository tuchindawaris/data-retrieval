import { SchemaMetadata } from './supabase'
import { 
  DatabaseKnowledgeMap, 
  TableNode, 
  ColumnNode, 
  DatabaseStatistics,
  IndexInfo,
  ForeignKeyInfo
} from './knowledge-map-types'

/**
 * Builds a complete Database knowledge map from schema metadata
 */
export function buildDatabaseKnowledgeMap(schemas: SchemaMetadata[]): DatabaseKnowledgeMap {
  const tree = buildTableTree(schemas)
  const statistics = calculateDatabaseStatistics(schemas, tree)
  
  return {
    timestamp: new Date().toISOString(),
    source: 'database',
    totalItems: tree.length,
    knowledgeTree: tree,
    statistics
  }
}

/**
 * Builds hierarchical table structure from schema metadata
 */
export function buildTableTree(schemas: SchemaMetadata[]): TableNode[] {
  const tableMap = new Map<string, TableNode>()
  
  // Group schemas by table
  schemas.forEach(schema => {
    if (!tableMap.has(schema.table_name)) {
      tableMap.set(schema.table_name, {
        id: `table_${schema.table_name}`,
        name: schema.table_name,
        type: 'table',
        schema: extractSchemaName(schema),
        columns: [],
        metadata: {
          indexes: extractIndexes(schema),
          primaryKey: extractPrimaryKey(schema),
          foreignKeys: extractForeignKeys(schema),
          rowCount: schema.metadata?.row_count,
          sizeEstimate: schema.metadata?.size_estimate,
          lastAnalyzed: schema.metadata?.last_analyzed
        }
      })
    }
    
    const table = tableMap.get(schema.table_name)!
    
    // Add column to table
    const column: ColumnNode = {
      name: schema.column_name,
      dataType: schema.data_type,
      isNullable: schema.is_nullable,
      ordinalPosition: schema.metadata?.ordinal_position,
      metadata: {
        defaultValue: schema.metadata?.default_value,
        isPrimaryKey: schema.metadata?.is_primary_key || false,
        isForeignKey: schema.metadata?.is_foreign_key || false,
        isUnique: schema.metadata?.is_unique || false,
        constraints: extractConstraints(schema),
        referencedTable: schema.metadata?.referenced_table,
        referencedColumn: schema.metadata?.referenced_column
      }
    }
    
    table.columns.push(column)
  })
  
  // Sort tables and their columns
  const tables = Array.from(tableMap.values())
  tables.sort((a, b) => a.name.localeCompare(b.name))
  
  tables.forEach(table => {
    // Sort columns by ordinal position or name
    table.columns.sort((a, b) => {
      if (a.ordinalPosition !== undefined && b.ordinalPosition !== undefined) {
        return a.ordinalPosition - b.ordinalPosition
      }
      return a.name.localeCompare(b.name)
    })
  })
  
  return tables
}

/**
 * Extract schema name from metadata
 */
function extractSchemaName(schema: SchemaMetadata): string | undefined {
  return schema.metadata?.schema_name || undefined
}

/**
 * Extract index information from metadata
 */
function extractIndexes(schema: SchemaMetadata): IndexInfo[] {
  if (!schema.metadata?.indexes) return []
  
  try {
    if (Array.isArray(schema.metadata.indexes)) {
      return schema.metadata.indexes.map((idx: any) => ({
        name: idx.name || 'unnamed_index',
        columns: Array.isArray(idx.columns) ? idx.columns : [idx.columns],
        isUnique: idx.is_unique || false,
        isPrimary: idx.is_primary || false
      }))
    }
  } catch (e) {
    console.error('Error parsing indexes:', e)
  }
  
  return []
}

/**
 * Extract primary key columns from metadata
 */
function extractPrimaryKey(schema: SchemaMetadata): string[] | undefined {
  if (!schema.metadata?.primary_key) return undefined
  
  if (Array.isArray(schema.metadata.primary_key)) {
    return schema.metadata.primary_key
  }
  
  if (typeof schema.metadata.primary_key === 'string') {
    return [schema.metadata.primary_key]
  }
  
  return undefined
}

/**
 * Extract foreign key relationships from metadata
 */
function extractForeignKeys(schema: SchemaMetadata): ForeignKeyInfo[] {
  if (!schema.metadata?.foreign_keys) return []
  
  try {
    if (Array.isArray(schema.metadata.foreign_keys)) {
      return schema.metadata.foreign_keys.map((fk: any) => ({
        constraintName: fk.constraint_name || 'unnamed_fk',
        column: fk.column || schema.column_name,
        referencedTable: fk.referenced_table,
        referencedColumn: fk.referenced_column
      }))
    }
  } catch (e) {
    console.error('Error parsing foreign keys:', e)
  }
  
  return []
}

/**
 * Extract column constraints from metadata
 */
function extractConstraints(schema: SchemaMetadata): string[] {
  const constraints: string[] = []
  
  if (schema.metadata?.is_primary_key) constraints.push('PRIMARY KEY')
  if (schema.metadata?.is_foreign_key) constraints.push('FOREIGN KEY')
  if (schema.metadata?.is_unique) constraints.push('UNIQUE')
  if (!schema.is_nullable) constraints.push('NOT NULL')
  if (schema.metadata?.check_constraint) constraints.push('CHECK')
  
  return constraints
}

/**
 * Calculate comprehensive statistics for Database tables
 */
function calculateDatabaseStatistics(
  schemas: SchemaMetadata[], 
  tables: TableNode[]
): DatabaseStatistics {
  const stats: DatabaseStatistics = {
    schemas: 0,
    tables: tables.length,
    views: 0,
    totalColumns: schemas.length,
    columnsWithDefaults: 0,
    tablesWithPrimaryKeys: 0,
    tablesWithIndexes: 0,
    foreignKeyRelationships: 0,
    nullableColumns: 0,
    nonNullableColumns: 0
  }
  
  // Count unique schemas
  const uniqueSchemas = new Set<string>()
  schemas.forEach(schema => {
    if (schema.metadata?.schema_name) {
      uniqueSchemas.add(schema.metadata.schema_name)
    }
  })
  stats.schemas = uniqueSchemas.size
  
  // Count column properties
  schemas.forEach(schema => {
    if (schema.metadata?.default_value !== undefined && 
        schema.metadata?.default_value !== null) {
      stats.columnsWithDefaults++
    }
    
    if (schema.is_nullable) {
      stats.nullableColumns++
    } else {
      stats.nonNullableColumns++
    }
  })
  
  // Count table-level properties
  tables.forEach(table => {
    // Count views (if metadata indicates it's a view)
    if (table.metadata?.rowCount === undefined && 
        table.name.toLowerCase().includes('view')) {
      stats.views++
    }
    
    // Count tables with primary keys
    if (table.metadata.primaryKey && table.metadata.primaryKey.length > 0) {
      stats.tablesWithPrimaryKeys++
    }
    
    // Count tables with indexes
    if (table.metadata.indexes && table.metadata.indexes.length > 0) {
      stats.tablesWithIndexes++
    }
    
    // Count foreign key relationships
    if (table.metadata.foreignKeys) {
      stats.foreignKeyRelationships += table.metadata.foreignKeys.length
    }
  })
  
  return stats
}