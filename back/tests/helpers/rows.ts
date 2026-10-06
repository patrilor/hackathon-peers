/**
 * Lectura de filas que devuelve `@libsql/client`.
 *
 * Los tipos de columna vienen como `string | number | bigint | ArrayBuffer`
 * según el protocolo y el driver, y los tipos de las filas de los tests no lo
 * concretan. Estos dos helpers obligan a decidir el tipo en el punto de lectura,
 * en vez de dejar un `as` o un `String(...)` que se traga cualquier cosa.
 */

/** Fila suelta de libSQL, o `undefined` si el `SELECT` no devolvió nada. */
export type RowLike = Record<string, unknown> | undefined

/**
 * Una columna como texto.
 *
 * @throws {Error} Si la columna no es texto ni número, para que el fallo esté en
 *   el test y no en un `undefined` más abajo.
 */
export function textOf(row: RowLike, column: string): string {
  const value = row?.[column]

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString()
  }

  throw new Error(`La columna ${column} no es texto: ${typeof value}`)
}

/** Una columna numérica. `COUNT(*)` puede venir como `bigint` o como texto. */
export function numberOf(row: RowLike, column: string): number {
  const value = row?.[column]

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'bigint' || typeof value === 'string') {
    return Number(value)
  }

  throw new Error(`La columna ${column} no es un número: ${typeof value}`)
}