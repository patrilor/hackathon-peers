/**
 * Tests del ciclo de autenticación.
 *
 * Se prueba el flujo entero sin servidor ni navegador: generar el login,
 * canjear el código, usar la sesión y cerrarla. El proveedor de 42 está
 * simulado, así que también se pueden reproducir los fallos que de verdad
 * importan: un `state` que no cuadra, un token que caduca, un 404 por falta
 * de scope.
 */

import { describe, expect, it } from 'vitest'

import { openDatabase } from '../../src/db/database.js'
import { createUsersRepository } from '../../src/db/repositories/users.js'
import { ApiError } from '../../src/api/errors.js'
import { DomainError } from '../../src/domain/errors.js'
import { createAuthService } from '../../src/auth/auth-service.js'
import { createOAuthClient, createPkcePair } from '../../src/auth/oauth-client.js'
import { randomToken, sign, verify } from '../../src/auth/signed-cookie.js'

const SECRET = 'secreto-de-prueba-para-los-tests'
const START = Date.UTC(2026, 9, 4, 12, 0, 0)

/** Reloj controlable. */
function makeClock() {
  let current = START

  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

/** Peticiones que el proveedor simulado va a recibir. */
type Recorded = { url: string; method: string; body: string; authorization: string }

/**
 * Proveedor de 42 simulado.
 *
 * `profileStatus` sirve para reproducir el `404 {}` que devuelve la API cuando
 * el token no lleva un scope de identidad, que es el fallo más probable de todo
 * el flujo y el más difícil de diagnosticar.
 */
function makeProvider(
  overrides: {
    profileStatus?: number
    tokenStatus?: number
    profile?: unknown
  } = {},
) {
  const requests: Recorded[] = []

  const fetchImpl: typeof fetch = async (input, init) => {
    // `fetch` admite string, URL o Request. Los tests siempre pasan un string.
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = init?.body
    const headers = init?.headers as Record<string, string> | undefined

    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof body === 'string' ? body : '',
      authorization: headers?.Authorization ?? '',
    })

    if (url.includes('/oauth/token')) {
      if (overrides.tokenStatus !== undefined) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: overrides.tokenStatus,
        })
      }

      return new Response(
        JSON.stringify({
          access_token: 'token-de-usuario',
          token_type: 'bearer',
          expires_in: 3600,
          scope: 'public profile',
        }),
        { status: 200 },
      )
    }

    if (overrides.profileStatus !== undefined) {
      // La 42 responde `404 {}` cuando el scope no está aprobado.
      return new Response('{}', { status: overrides.profileStatus })
    }

    return new Response(
      JSON.stringify(
        overrides.profile ?? {
          id: 1,
          login: 'albrodri',
          kind: 'student',
          usual_full_name: 'Alberto',
          image: { url: 'https://img/1.png' },
        },
      ),
      { status: 200 },
    )
  }

  return { fetchImpl, requests }
}

/** Servicio montado, con la base en memoria y el reloj controlable. */
function makeAuth(overrides: Parameters<typeof makeProvider>[0] = {}) {
  const db = openDatabase(':memory:')
  const users = createUsersRepository(db)
  const clock = makeClock()
  const provider = makeProvider(overrides)

  const oauth = createOAuthClient({
    authorizeUrl: 'https://api.test/oauth/authorize',
    tokenUrl: 'https://api.test/oauth/token',
    clientId: 'u-test',
    clientSecret: 's-test',
    redirectUri: 'https://back.test/auth/callback',
    userAgent: 'sanatorio-42-test/1.0',
    fetchImpl: provider.fetchImpl,
  })

  const auth = createAuthService({
    db,
    users,
    oauth,
    secret: SECRET,
    frontendUrl: 'https://front.test',
    now: clock.now,
  })

  return { auth, users, clock, requests: provider.requests }
}

/** Login completo, como lo haría un navegador. */
async function login(auth: ReturnType<typeof makeAuth>['auth']) {
  const start = auth.startLogin()
  const state = new URL(start.redirectUrl).searchParams.get('state') ?? ''

  const result = await auth.finishLogin({
    code: 'codigo-de-prueba',
    state,
    stateCookie: start.stateCookie,
  })

  return { start, state, result }
}

describe('cookies firmadas', () => {
  it('firma y verifica', () => {
    const signed = sign(SECRET, 'hola')

    expect(verify(SECRET, signed)).toBe('hola')
  })

  it('devuelve undefined si el valor se ha cambiado', () => {
    const signed = sign(SECRET, 'hola')
    const manipulado = `otro${signed.slice(signed.indexOf('.'))}`

    expect(verify(SECRET, manipulado)).toBeUndefined()
  })

  it('devuelve undefined con otro secreto', () => {
    expect(verify('otro-secreto', sign(SECRET, 'hola'))).toBeUndefined()
  })

  it('devuelve undefined si no hay firma', () => {
    expect(verify(SECRET, 'hola')).toBeUndefined()
    expect(verify(SECRET, '')).toBeUndefined()
    expect(verify(SECRET, '.firma')).toBeUndefined()
  })

  it('genera tokens distintos cada vez', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken()))

    expect(tokens.size).toBe(50)
  })
})

describe('oauth client', () => {
  it('usa los scopes que le pasan, para poder corregirlos sin desplegar', () => {
    const { fetchImpl } = makeProvider()
    const oauth = createOAuthClient({
      authorizeUrl: 'https://api.test/oauth/authorize',
      tokenUrl: 'https://api.test/oauth/token',
      clientId: 'u-test',
      clientSecret: 's-test',
      redirectUri: 'https://back.test/auth/callback',
      userAgent: 'test/1.0',
      scopes: ['public', 'otro-scope'],
      fetchImpl,
    })

    const url = new URL(oauth.authorizeUrl({ state: 'abc' }))

    expect(url.searchParams.get('scope')).toBe('public otro-scope')
  })

  it('se niega a construir una autorización sin scopes', () => {
    const { fetchImpl } = makeProvider()

    expect(() =>
      createOAuthClient({
        authorizeUrl: 'https://api.test/oauth/authorize',
        tokenUrl: 'https://api.test/oauth/token',
        clientId: 'u-test',
        clientSecret: 's-test',
        redirectUri: 'https://back.test/auth/callback',
        userAgent: 'test/1.0',
        scopes: [],
        fetchImpl,
      }),
    ).toThrow(/scope/)
  })

  it('pide los scopes de identidad y un `state`', () => {
    const { fetchImpl } = makeProvider()
    const oauth = createOAuthClient({
      authorizeUrl: 'https://api.test/oauth/authorize',
      tokenUrl: 'https://api.test/oauth/token',
      clientId: 'u-test',
      clientSecret: 's-test',
      redirectUri: 'https://back.test/auth/callback',
      userAgent: 'test/1.0',
      fetchImpl,
    })

    const url = new URL(oauth.authorizeUrl({ state: 'abc' }))
    const params = url.searchParams

    expect(url.origin + url.pathname).toBe('https://api.test/oauth/authorize')
    expect(params.get('response_type')).toBe('code')
    expect(params.get('client_id')).toBe('u-test')
    expect(params.get('state')).toBe('abc')
    // Sin scope de identidad la API concede solo `public` y `/v2/me` da 404.
    expect(params.get('scope')).toBe('public profile')
    expect(params.get('redirect_uri')).toBe('https://back.test/auth/callback')
  })

  it('añade PKCE con S256', () => {
    const { fetchImpl } = makeProvider()
    const oauth = createOAuthClient({
      authorizeUrl: 'https://api.test/oauth/authorize',
      tokenUrl: 'https://api.test/oauth/token',
      clientId: 'u-test',
      clientSecret: 's-test',
      redirectUri: 'https://back.test/auth/callback',
      userAgent: 'test/1.0',
      fetchImpl,
    })

    const { verifier, challenge } = createPkcePair()
    const url = new URL(oauth.authorizeUrl({ state: 'abc', pkce: { verifier, challenge } }))

    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(challenge)
    // El verifier NUNCA va en la URL: solo viaja al canjear el código.
    expect(url.searchParams.get('code_verifier')).toBeNull()
  })

  it('manda Basic auth, el verifier y el User-Agent al canjear', async () => {
    const provider = makeProvider()
    const oauth = createOAuthClient({
      authorizeUrl: 'https://api.test/oauth/authorize',
      tokenUrl: 'https://api.test/oauth/token',
      clientId: 'u-test',
      clientSecret: 's-test',
      redirectUri: 'https://back.test/auth/callback',
      userAgent: 'test/1.0',
      fetchImpl: provider.fetchImpl,
    })

    const { verifier } = createPkcePair()
    const token = await oauth.exchangeCode({ code: 'abc', verifier })

    expect(token.access_token).toBe('token-de-usuario')
    const request = provider.requests[0]
    expect(request?.authorization).toBe(`Basic ${Buffer.from('u-test:s-test').toString('base64')}`)
    expect(request?.body).toContain('grant_type=authorization_code')
    expect(request?.body).toContain(`code_verifier=${verifier}`)
  })
})

describe('ciclo de login', () => {
  it('devuelve la URL de la 42 con state y cookie', () => {
    const { auth } = makeAuth()

    const start = auth.startLogin()

    expect(start.redirectUrl).toContain('https://api.test/oauth/authorize')
    expect(start.stateCookie.length).toBeGreaterThan(20)
  })

  it('completa el login y devuelve sesión y redirección al front', async () => {
    const { auth } = makeAuth()

    const { result } = await login(auth)

    expect(result.login).toBe('albrodri')
    expect(result.image).toBe('https://img/1.png')
    expect(result.redirectUrl).toBe('https://front.test')
  })

  it('replica a la persona, para que `sessions` no choca con la FK', async () => {
    const { auth, users } = makeAuth()

    await login(auth)

    expect(users.findByLogin('albrodri')?.user_id).toBe(1)
  })

  it('la cookie de sesión NO lleva el token de 42', async () => {
    const { auth } = makeAuth()

    const { result } = await login(auth)
    const sessionId = verify(SECRET, result.sessionCookie)

    // Solo el identificador. El token se queda en la base.
    expect(sessionId).toBe(result.sessionId)
    expect(result.sessionCookie).not.toContain('token-de-usuario')
  })

  it('lee la persona de la sesión', async () => {
    const { auth } = makeAuth()
    const { result } = await login(auth)

    const current = auth.currentUser(result.sessionCookie)

    expect(current.login).toBe('albrodri')
    expect(current.accessToken).toBe('token-de-usuario')
  })

  it('cierra la sesión de verdad: la cookie deja de servir', async () => {
    const { auth } = makeAuth()
    const { result } = await login(auth)

    auth.logout(result.sessionCookie)

    expect(() => auth.currentUser(result.sessionCookie)).toThrow(DomainError)
    expect(auth.sessions.count()).toBe(0)
  })

  it('cerrar dos veces no es un error', async () => {
    const { auth } = makeAuth()
    const { result } = await login(auth)

    auth.logout(result.sessionCookie)

    expect(() => {
      auth.logout(result.sessionCookie)
    }).not.toThrow()
  })
})

describe('lo que debe fallar', () => {
  it('rechaza un `state` que no coincide', async () => {
    const { auth } = makeAuth()
    const start = auth.startLogin()

    await expect(
      auth.finishLogin({
        code: 'abc',
        state: 'un-state-plantado',
        stateCookie: start.stateCookie,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rechaza un login sin cookie de estado', async () => {
    const { auth } = makeAuth()
    const start = auth.startLogin()
    const state = new URL(start.redirectUrl).searchParams.get('state') ?? ''

    await expect(
      auth.finishLogin({ code: 'abc', state, stateCookie: undefined }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rechaza una cookie de estado caducada', async () => {
    const { auth, clock } = makeAuth()
    const start = auth.startLogin()
    const state = new URL(start.redirectUrl).searchParams.get('state') ?? ''

    // El enlace de login se deja abierto en un correo y alguien lo pulsa al día
    // siguiente. A los diez minutos ya no vale.
    clock.advance(11 * 60 * 1000)

    await expect(
      auth.finishLogin({ code: 'abc', state, stateCookie: start.stateCookie }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rechaza una cookie de estado manipulada', async () => {
    const { auth } = makeAuth()
    const start = auth.startLogin()
    const state = new URL(start.redirectUrl).searchParams.get('state') ?? ''
    const manipulada = `${start.stateCookie.slice(0, -4)}abcd`

    await expect(
      auth.finishLogin({ code: 'abc', state, stateCookie: manipulada }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('explica que falta un scope de identidad cuando la API da 404', async () => {
    const { auth } = makeAuth({ profileStatus: 404 })

    // Es el fallo que más cuesta diagnosticar: la API responde `404 {}` y no
    // dice que lo que falta es el scope aprobado en el panel.
    await expect(login(auth)).rejects.toThrow(/scope de identidad/)
  })

  it('propaga un canje fallido', async () => {
    const { auth } = makeAuth({ tokenStatus: 401 })

    await expect(login(auth)).rejects.toBeInstanceOf(ApiError)
  })

  it('lanza 401 si se pide la persona sin sesión', () => {
    const { auth } = makeAuth()

    expect(() => auth.currentUser(undefined)).toThrow(DomainError)
    try {
      auth.currentUser(undefined)
    } catch (error) {
      expect((error as DomainError).code).toBe('unauthenticated')
    }
  })

  it('lanza 401 con una cookie manipulada', () => {
    const { auth } = makeAuth()

    expect(() => auth.currentUser(sign('otro-secreto', 'inventado'))).toThrow(DomainError)
  })

  it('una sesión caducada no vale, y se limpia al leerla', async () => {
    const { auth, clock } = makeAuth()
    const { result } = await login(auth)

    // La sesión vive lo que el token: 3600 s en el proveedor simulado.
    clock.advance(3601 * 1000)

    expect(() => auth.currentUser(result.sessionCookie)).toThrow(DomainError)
    // Se borró al leerla: no se acumulan sesiones muertas.
    expect(auth.sessions.count()).toBe(0)
  })

  it('nunca vive más que el token de 42', async () => {
    const { auth, clock } = makeAuth()
    const { result } = await login(auth)

    const session = auth.readSession(result.sessionCookie)

    expect(session?.expiresAt).toBeLessThanOrEqual(clock.now() + 3600 * 1000)
  })

  it('purga las sesiones caducadas', async () => {
    const { auth, clock } = makeAuth()
    await login(auth)
    await login(auth)

    expect(auth.sessions.count()).toBe(2)

    clock.advance(3601 * 1000)
    expect(auth.purgeExpiredSessions()).toBe(2)
    expect(auth.sessions.count()).toBe(0)
  })
})
