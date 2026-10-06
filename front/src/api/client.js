// Cliente real contra el backend. Usa cookies de sesión (credentials: 'include').
const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * Cuánto se espera antes de rendir la petición.
 *
 * Vercel responde las funciones frías en 1-2 s y una caché vacía puede tardar
 * algo más, pero un back caído se cuelga indefinidamente. Este tope convierte el
 * cuelgue en un error visible, que es lo único que el front sabe mostrar.
 */
const TIMEOUT_MS = 15_000

/**
 * Una petición ya comprobada.
 *
 * @throws {Error} `network: true` si no hay respuesta (sin servidor, sin red o
 *   timeout) y `status` si el servidor respondió con un error. Esa distinción es
 *   la que permite decir "no puedes entrar" (401) sin confundirlo con "no hay
 *   servidor" (red).
 */
async function pedir(path, options = {}) {
  let res

  try {
    res = await fetch(BASE + path, {
      credentials: 'include',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...options,
    })
  } catch (cause) {
    const error = new Error('No se puede conectar con el servidor')
    error.network = true
    error.cause = cause
    throw error
  }

  if (!res.ok) {
    const error = new Error(`${res.status} ${res.statusText}`)
    error.status = res.status
    throw error
  }

  return res
}

async function request(path, options = {}) {
  const res = await pedir(path, options)
  if (res.status === 204) return null
  return res.json()
}

/** Un entero de cabecera, o `null` si no viene. */
function cabeceraEntera(res, nombre) {
  const crudo = res.headers.get(nombre)
  if (crudo === null || crudo.trim() === '') return null
  const valor = Number(crudo)
  return Number.isNaN(valor) ? null : valor
}

export const realApi = {
  getMe: () => request('/auth/me'),

  login() {
    window.location.href = BASE + '/auth/login'
    return new Promise(() => {})
  },

  logout: () => request('/auth/logout', { method: 'POST' }),

  getMyProjects: () => request('/me/projects'),

  /**
   * `GET /projects/:id/peers`.
   *
   * El cuerpo trae solo los accionables, y el tamaño real del proyecto vive en
   * las cabeceras `X-Total-Participants` y `X-Partial`. Se leen aquí porque el
   * front solo debe saber de datos, no de cabeceras.
   */
  getPeers: async (projectId) => {
    const res = await pedir(`/projects/${projectId}/peers`)
    return {
      peers: await res.json(),
      total: cabeceraEntera(res, 'x-total-participants'),
      partial: res.headers.get('x-partial') === 'true',
    }
  },

  // El back responde `GET /me/availability` con `{ available: true }` (envuelve
  // el booleano en `AvailabilityResponse`). Aquí se desenvuelve para devolver
  // un booleano, que es lo que espera `mockApi.getAvailability` y lo que
  // consume AvailabilityToggle. Si no se desenvuelve, `guardando === true` en
  // el componente nunca sería cierto y el interruptor se vería apagado siempre.
  getAvailability: async () => {
    const respuesta = await request('/me/availability')
    return respuesta.available === true
  },

  setAvailability: (available) =>
    request('/me/availability', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available }),
    }),
}