/**
 * Sesiones guardadas en SQLite.
 *
 * La cookie lleva un identificador opaco y firmado, no el token de 42. Así el
 * token no viaja en cada petición y el logout es un borrado de verdad: si el
 * navegador no borra la cookie, la sesión ya no existe.
 */

import type { Db } from '../db/database.js'
import { randomToken } from './signed-cookie.js'

type SessionRow = {
  session_id: string
  login: string
  access_token: string
  expires_at: number
}

export type Session = {
  sessionId: string
  login: string
  accessToken: string
  expiresAt: number
}

export type CreateSessionOptions = {
  /** Token de usuario de 42, para las llamadas que lo necesiten. */
  accessToken: string
  /** Cuándo caduca, en epoch ms. */
  expiresAt: number
}

export function createSessionsRepository(db: Db) {
  const insert = db.prepare(
    `INSERT INTO sessions (session_id, login, access_token, expires_at, created_at)
     VALUES (@session_id, @login, @access_token, @expires_at, @created_at)
     ON CONFLICT (session_id) DO UPDATE SET
       access_token = excluded.access_token,
       expires_at   = excluded.expires_at`,
  )

  const select = db.prepare<[string], SessionRow>('SELECT * FROM sessions WHERE session_id = ?')
  const remove = db.prepare('DELETE FROM sessions WHERE session_id = ?')

  /** Crea una sesión nueva con un identificador aleatorio. */
  function create(login: string, options: CreateSessionOptions): Session {
    const session: Session = {
      sessionId: randomToken(),
      login,
      accessToken: options.accessToken,
      expiresAt: options.expiresAt,
    }

    insert.run({
      session_id: session.sessionId,
      login,
      access_token: session.accessToken,
      expires_at: session.expiresAt,
      created_at: new Date().toISOString(),
    })

    return session
  }

  /**
   * Sesión válida, o `undefined` si no existe o ya caducó.
   *
   * Una sesión caducada se borra al leerla: es más limpio que esperar a una
   * pasada de limpieza, y así no se acumulan.
   */
  function findValid(sessionId: string, now: number): Session | undefined {
    const row = select.get(sessionId)

    if (row === undefined) {
      return undefined
    }

    if (row.expires_at <= now) {
      remove.run(sessionId)
      return undefined
    }

    return {
      sessionId: row.session_id,
      login: row.login,
      accessToken: row.access_token,
      expiresAt: row.expires_at,
    }
  }

  return {
    create,
    findValid,
    /** Invalida una sesión. Devuelve si estaba. */
    destroy(sessionId: string): boolean {
      const info = remove.run(sessionId)
      return info.changes > 0
    },
    /** Borra las caducadas. Lo llama el arranque y de vez en cuando. */
    purgeExpired(now: number): number {
      return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes
    },
    count(): number {
      return (
        db.prepare<unknown[], { total: number }>('SELECT COUNT(*) AS total FROM sessions').get()
          ?.total ?? 0
      )
    },
  }
}

export type SessionsRepository = ReturnType<typeof createSessionsRepository>
