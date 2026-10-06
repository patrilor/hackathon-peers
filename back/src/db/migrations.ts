/**
 * Migraciones del esquema SQLite.
 *
 * Cada migración es inmutable: una vez publicada no se edita, se añade otra.
 * El número de versión se guarda en `PRAGMA user_version`, que es la forma
 * que SQLite ofrece para esto sin crear una tabla extra.
 *
 * ## Por qué el número salta a 10
 *
 * El esquema anterior (réplica completa) llegó a la versión 3. La primera
 * migración de este esquema mínimo se llama **versión 10** a propósito, no 1: un
 * número bajo haría que una base ya migrada a la 3 pareciera *más nueva* que el
 * código, no se le aplicaría nada y fallaría la primera consulta con "no such
 * table: cache". Con un número por encima de todo lo histórico, cualquier base
 * existente pasa por esta migración y toda base nueva arranca en 0 y la aplica.
 *
 * La migración también **borra** las tablas de la réplica. No es descuido: sus
 * datos eran una copia de la API de 42, que se vuelve a pedir cuando hace falta,
 * así que no hay nada que conservar. Ver el comentario de cada `DROP TABLE`.
 *
 * Por qué **no** replicamos la API de 42 entera, que es lo que hacía la
 * versión anterior de este esquema:
 *
 * La API limita a 2 peticiones por segundo. Un solo proyecto grande ("Call Me
 * Maybe", `2689`) tiene 2 047 participantes, que son 21 páginas de 100. Y el
 * catálogo global son 1 702 proyectos, 18 páginas más. Replicarlo todo costaba
 * más de 100 segundos por ciclo, quemaba la cuota de 1 200 peticiones por hora
 * y obligaba a que **cada lectura** esperara a la sincronización: con la 42
 * contestando `503`, una petición podía tardar minutos y morir.
 *
 * Aquí no hay réplica. Hay una caché de lectura bajo demanda y una tabla con el
 * único dato que Sanatorio inventa. Dos tablas, y el back va rápido porque casi
 * siempre lee de la caché.
 */

/** Una migración: versión, nombre y las sentencias SQL que la componen. */
export type Migration = {
  /** Versión única y creciente. Es el número que va en `user_version`. */
  readonly version: number
  /** Nombre legible, para saber qué se ejecutó al leer los logs. */
  readonly name: string
  /** Sentencias SQL, en orden. */
  readonly statements: readonly string[]
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 10,
    name: 'esquema-minimo',
    statements: [
      // --- Fuera la réplica --------------------------------------------------
      // Tablas del esquema anterior. Se borran antes de crear las nuevas para
      // que el resultado no dependa del orden.
      //
      // `sync_state` guardaba en qué punto iba la sincronización; sin
      // sincronización no tiene sentido. `users` y `projects` eran copias
      // íntegras de la API, y `user_projects` su relación: los tres se vuelven a
      // pedir bajo demanda. Perderlos no es perder información, es tirar una
      // caché.
      //
      // **No** se borra `availability`: ahí está la decisión de "de guardia" que
      // puso la gente, y no se puede volver a pedirle a la API. Se conserva tal
      // cual; el `CREATE` de abajo lleva `IF NOT EXISTS` por si acaso, y por
      // si la migración se corta y hay que reintentarla.
      `DROP TABLE IF EXISTS user_projects`,
      `DROP TABLE IF EXISTS users`,
      `DROP TABLE IF EXISTS projects`,
      `DROP TABLE IF EXISTS sync_state`,

      // --- Guardia ---------------------------------------------------------
      // ESTE DATO NO EXISTE EN LA API DE 42. Nadie en 42 publica si está
      // disponible para hacerte una pareja. Por eso `available` solo puede
      // venir de aquí, y por eso es la única tabla que la web escribe.
      //
      // No hay clave foránea a ninguna tabla de personas: no hay tabla de
      // personas. Quien entra puede marcarse disponible sin que nada más
      // exista sobre él en nuestra base.
      //
      // La tabla de antes tenía una clave foránea a `users`, que aquí ya no
      // existe. Para las bases antiguas, se reconstruye sin ella: se copia a una
      // tabla nueva y se cambia el nombre, porque `ALTER TABLE ... DROP
      // COLUMN` no es válido en SQLite.
      `CREATE TABLE IF NOT EXISTS availability (
        login      TEXT PRIMARY KEY,
        available  INTEGER NOT NULL DEFAULT 0 CHECK (available IN (0, 1)),
        updated_at TEXT NOT NULL
      )`,

      // --- Caché genérica --------------------------------------------------
      // Una sola tabla para todo lo que viene de la API de 42. El `key` dice
      // qué es, y el JSON es lo que se devolvió:
      //
      //   'peers:2689:meta'          { total, per_page, pages }
      //   'peers:2689:p1' … ':p21'   [ { login, image, location, status }, … ]
      //   'user_projects:albrodri'   [ { id, name }, … ]
      //
      // Los participantes van **una fila por página** y no uno solo con todo
      // dentro, por dos razones: el proyecto 2689 no cabe cómodo en una fila
      // (unos 400 KB de JSON) y, sobre todo, porque así la descarga se puede
      // presupuestar por páginas. La API va a 2 peticiones por segundo, así que
      // bajarse las 21 enteras son ~11 s, más que el límite de duración de una
      // función en Vercel. Cada petición se gasta un presupuesto pequeño y las
      // siguientes van reuniendo lo que ya hay.
      //
      // Una tabla genérica en vez de una por recurso: con dos recursos en
      // caché, dos tablas casi idénticas son más código que una con un
      // discriminante, y la clave ya dice qué es cada fila.
      `CREATE TABLE IF NOT EXISTS cache (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )`,

      // Para purgar lo caducado en un solo `DELETE`, que es la operación de
      // mantenimiento de la caché.
      `CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache (expires_at)`,
    ],
  },
]

/** Versión más alta que existe en el código. */
export const LATEST_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
)