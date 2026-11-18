// Papaparse ships no TypeScript declarations in this pinned installation.
// This local shim covers only the parse/unparse surface used by size-table import/export.
declare module 'papaparse' {
  export interface ParseError {
    message: string
  }
  export interface ParseResult<T> {
    data: T[]
    errors: ParseError[]
  }
  export interface ParseConfig {
    skipEmptyLines?: boolean | 'greedy'
  }
  export interface UnparseConfig {
    escapeFormulae?: boolean
    newline?: string
  }
  const Papa: {
    parse<T>(input: string, config?: ParseConfig): ParseResult<T>
    unparse(data: unknown[][], config?: UnparseConfig): string
  }
  export default Papa
}
