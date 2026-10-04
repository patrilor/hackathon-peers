/**
 * Montaje del cliente de 42 a partir del entorno.
 *
 * Vive aquí y no en el servidor ni en el CLI para que los dos usen
 * exactamente los mismos límites: si el `sync-once` gastara distinto, la
 * cuota de 1200 req/h se consumiría en el peor momento.
 */

import { FortyTwoClient } from './client.js'
import { RateLimiter } from './rate-limiter.js'
import { TokenManager } from './token-manager.js'
import type { Env } from '../config/env.js'

export function createApiClient(env: Env, fetchImpl: typeof fetch = fetch): FortyTwoClient {
  // Los tres topes salen del entorno, y no de constantes aquí: el CLI y el
  // servidor tienen que gastar igual, o la cuota se consume a distinto ritmo
  // según quién sincronice.
  const limiter = new RateLimiter({
    minDelayMs: Math.round(env.API_REQUEST_DELAY_SECONDS * 1000),
    maxPerMinute: env.SYNC_REQUESTS_PER_MINUTE,
    maxPerHour: env.SYNC_REQUESTS_PER_HOUR,
  })

  const tokens = new TokenManager({
    tokenUrl: env.FORTY_TWO_TOKEN_URL,
    uid: env.FORTY_TWO_UID,
    secret: env.FORTY_TWO_SECRET,
    userAgent: env.FORTY_TWO_USER_AGENT,
    fetchImpl,
  })

  return new FortyTwoClient({
    apiV2Base: env.apiV2Base,
    userAgent: env.FORTY_TWO_USER_AGENT,
    timeoutMs: 30_000,
    heavyTimeoutMs: 120_000,
    pageSize: 100,
    limiter,
    tokens,
    fetchImpl,
  })
}
