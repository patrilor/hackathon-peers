/**
 * Migraciones del esquema SQLite.
 *
 * Cada migración es inmutable: una vez publicada no se edita, se añade otra.
 * El número de versión se guarda en `PRAGMA user_version`, que es la forma
 * que SQLite ofrece para esto sin crear una tabla extra.
 *
 * Por qué replicamos datos y no consultamos la API en cada petición:
 * la API de 42 limita a 2 peticiones por segundo, y distinguir quién tiene
 * un proyecto en curso de quien ya lo aprobó exige pedir `projects_users`
 * persona a persona. En un proyecto común son cientos de llamadas: imposible
 * hacerlo dentro de un request. Guardamos, entonces, una réplica local.
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
    version: 1,
    name: 'esquema-inicial',
    statements: [
      // --- Personas -------------------------------------------------------
      // `login` es la clave natural porque es lo que devuelve el front en
      // `docs/api.md` y lo que usa 42 en la URL de los perfiles.
      // Guardamos también `user_id` porque algunas rutas de la API lo exigen.
      `CREATE TABLE users (
        login            TEXT PRIMARY KEY,
        user_id          INTEGER NOT NULL,
        kind             TEXT NOT NULL DEFAULT 'student',
        usual_full_name  TEXT,
        image_url        TEXT,
        synced_at        TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX idx_users_user_id ON users (user_id)`,

      // --- Ubicaciones ----------------------------------------------------
      // El "puesto" del cluster. La API lo llama `host` ("c2r17s2") dentro de
      // /campus/:id/locations. Solo guardamos quien está en el campus ahora.
      `CREATE TABLE user_locations (
        login       TEXT PRIMARY KEY REFERENCES users (login) ON DELETE CASCADE,
        campus_id   INTEGER NOT NULL,
        host        TEXT NOT NULL,
        is_primary  INTEGER NOT NULL DEFAULT 1,
        updated_at  TEXT NOT NULL
      )`,
      `CREATE INDEX idx_user_locations_campus ON user_locations (campus_id)`,

      // --- Proyectos ------------------------------------------------------
      // Catálogo mínimo: solo el id y el nombre, que es lo que necesita el front.
      `CREATE TABLE projects (
        id    INTEGER PRIMARY KEY,
        name  TEXT NOT NULL,
        slug  TEXT
      )`,
      `CREATE INDEX idx_projects_name ON projects (name)`,

      // --- Estado de cada persona en cada proyecto -------------------------
      // El corazón del modelo. `status` distingue "lo está haciendo" de
      // "ya lo aprobó", que es justo lo que separa a un especialista.
      // La API devuelve más valores ('waiting_to_be_started', 'upcoming', …):
      // solo nos interesan estos dos, y se filtran al escribir.
      `CREATE TABLE user_projects (
        login       TEXT NOT NULL REFERENCES users (login) ON DELETE CASCADE,
        project_id  INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        status      TEXT NOT NULL CHECK (status IN ('in_progress', 'finished')),
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (login, project_id)
      )`,
      // Índice compuesto porque la consulta caliente es
      // "todos los de este proyecto, agrupados por estado".
      `CREATE INDEX idx_user_projects_by_project
        ON user_projects (project_id, status)`,

      // --- Guardia ---------------------------------------------------------
      // ESTE DATO NO EXISTE EN LA API DE 42. Es nuestro.
      // Por eso `available` solo puede venir de aquí.
      `CREATE TABLE availability (
        login       TEXT PRIMARY KEY REFERENCES users (login) ON DELETE CASCADE,
        available   INTEGER NOT NULL DEFAULT 0 CHECK (available IN (0, 1)),
        updated_at  TEXT NOT NULL
      )`,

      // --- Estado de la sincronización ------------------------------------
      // Checkpoints y marcas de tiempo, para poder reanudar y saber
      // desde cuándo es válido cada cosa.
      `CREATE TABLE sync_state (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )`,
    ],
  },
]

/** Versión más alta que existe en el código. */
export const LATEST_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
)