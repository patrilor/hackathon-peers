/**
 * Montaje del cliente de 42 a partir del entorno.
 *
 * Vive aquí y no en el servidor para que el wire-up de la app sea el mismo en
 * los tests de integración que en producción: si el servidor construyera el
 * cliente con otros topes, los tests no valdrían para nada.
 */

import { FortyTwoClient } from './client.js'
import { createAppTokenProvider } from './app-token.js'
import { createThrottle } from './throttle.js'
import type { Env } from '../config/env.js'

export function createApiClient(env: Env, fetchImpl: typeof fetch = fetch): FortyTwoClient {
  const throttle = createThrottle({ minIntervalMs: env.MIN_REQUEST_INTERVAL_MS })

  const tokens = createAppTokenProvider({
    tokenUrl: env.FORTY_TWO_TOKEN_URL,
    uid: env.FORTY_TWO_UID,
    secret: env.FORTY_TWO_SECRET,
    userAgent: env.FORTY_TWO_USER_AGENT,
    fetchImpl,
  })

  return new FortyTwoClient({
    apiV2Base: env.apiV2Base,
    userAgent: env.FORTY_TWO_USER_AGENT,
    timeoutMs: env.API_TIMEOUT_MS,
    pageSize: env.PAGE_SIZE,
    maxRetries: env.API_MAX_RETRIES,
    throttle,
    tokens,
    fetchImpl,
  })
}