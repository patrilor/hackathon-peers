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
          // La forma real de la 42: `image` no es una URL, es un objeto con
          // `link` y cuatro tamaños. Verificado contra `GET /v2/users/<login>`.
          image: {
            link: 'https://img/1.png',
            versions: {
              large: 'https://img/1-large.png',
              medium: 'https://img/1-medium.png',
              small: 'https://img/1-small.png',
              micro: 'https://img/1-micro.png',
            },
          },
        },
      ),
      { status: 200 },
    )
  }

  return { fetchImpl, requests }
}

/** Servicio montado, con la base en memoria y el reloj controlable. */
function makeAuth(overrides: Parameters<typeof makeProvider>[0] = {}) {
  const clock = makeClock()
  const provider = makeProvider(overrides)

  const oauth = createOAuthClient({
    authorizeUrl: 'https://api.test/oauth/authorize',
    tokenUrl: 'https://api.test/oauth/token',
    clientId: 'u-test',
    clientSecret: 's-test',
    redirectUri: 'https://back.test/api/auth/callback',
    userAgent: 'sanatorio-42-test/1.0',
    fetchImpl: provider.fetchImpl,
  })

  // Sin base de datos: la sesión va dentro de la cookie firmada, así que aquí no
  // hay nada que abrir ni que migrar.
  const auth = createAuthService({
    oauth,
    secret: SECRET,
    frontendUrl: 'https://front.test',
    now: clock.now,
  })

  return { auth, clock, requests: provider.requests }
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
    // Sale el tamaño `medium`, no `link`: es el que se ve bien a 48 px y no
    // gasta la foto entera en móvil.
    expect(result.image).toBe('https://img/1-medium.png')
    expect(result.redirectUrl).toBe('https://front.test')
  })

  it('la cookie de sesión lleva el perfil, no el token de 42', async () => {
    const { auth } = makeAuth()

    const { result } = await login(auth)
    const payload = verify(SECRET, result.sessionCookie)

    // Antes la cookie llevaba un identificador opaco y el token se guardaba en la
    // base. Ahora lleva el perfil firmado, y el token de 42 no se guarda en
    // ninguna parte: se tira después de leer `/v2/me`.
    const decoded = JSON.parse(
      Buffer.from(String(payload), 'base64url').toString('utf8'),
    ) as Record<string, unknown>

    expect(decoded.login).toBe('albrodri')
    expect(decoded.image).toBe('https://img/1-medium.png')
    expect(typeof decoded.exp).toBe('number')
    expect(result.sessionCookie).not.toContain('token-de-usuario')
  })

  it('lee la persona de la sesión sin tocar nada más', async () => {
    const { auth } = makeAuth()
    const { result } = await login(auth)

    const current = auth.currentUser(result.sessionCookie)

    expect(current.login).toBe('albrodri')
    expect(current.name).toBe('Alberto')
    expect(current.image).toBe('https://img/1-medium.png')
  })

  it('no acepta una sesión firmada con otro secreto', async () => {
    const { auth } = makeAuth()

    // Suplantar a alguien es tan fácil como cambiar una letra de la cookie, si la
    // firma no está.
    const falsificada = sign('otro-secreto', 'inventado')

    expect(() => auth.currentUser(falsificada)).toThrow(DomainError)
  })

  it('devuelve undefined en vez de lanzar cuando solo se pregunta', () => {
    const { auth } = makeAuth()

    // `readSession` es para uso interno y no ha de romper al llamador.
    expect(auth.readSession(undefined)).toBeUndefined()
    expect(auth.readSession('no-es-una-cookie')).toBeUndefined()
  })

  it('logout no necesita cookie: la cookie es la sesión', async () => {
    const { auth } = makeAuth()
    const { result } = await login(auth)

    // No hay servidor al que avisar. Vaciar la cookie es todo el logout, así que
    // la firma no tiene que llevar nada.
    auth.logout()

    // Y no hay estado que limpiar: una copia de la cookie seguiría siendo válida
    // hasta que caduque, que es el compromiso de no tener sesiones revocables.
    expect(() => auth.currentUser(result.sessionCookie)).not.toThrow()
    expect(auth.readSession(result.sessionCookie)?.login).toBe('albrodri')
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

  it('una sesión caducada no vale, aunque la cookie siga ahí', async () => {
    const { auth, clock } = makeAuth()
    const { result } = await login(auth)

    // 12 h de vida por defecto; se pasa un poco más.
    clock.advance(12 * 60 * 60 * 1000 + 1_000)

    expect(() => auth.currentUser(result.sessionCookie)).toThrow(DomainError)
  })

  it('la caducidad la trae firmada, no solo en el Max-Age de la cookie', async () => {
    const { auth, clock } = makeAuth()
    const { result } = await login(auth)

    const payload = JSON.parse(
      Buffer.from(String(verify(SECRET, result.sessionCookie)), 'base64url').toString('utf8'),
    ) as { exp: number }

    // El `exp` va dentro del valor firmado: alguien que reescriba el `Max-Age` de
    // la cookie a mano no gana nada, porque el servidor lo comprueba igual.
    expect(payload.exp).toBe(clock.now() + 12 * 60 * 60 * 1000)
  })

  it('no acepta un payload sin `exp`', async () => {
    const { auth } = makeAuth()

    // Cookie firmada correctamente pero sin caducidad: no se puede aceptar, o
    // sería una sesión eterna firmada por accidente.
    const sinCaducidad = sign(SECRET, Buffer.from(JSON.stringify({ login: 'albrodri' })).toString('base64url'))

    expect(auth.readSession(sinCaducidad)).toBeUndefined()
  })

  it('no acepta un payload con `exp` que no es un número', async () => {
    const { auth } = makeAuth()

    // Un `NaN` serializado pasa un `typeof === 'number'` y haría que
    // `now() > NaN` fuera `false`: una sesión que no caduca nunca.
    const raro = sign(SECRET, Buffer.from(JSON.stringify({ login: 'albrodri', exp: 'mañana' })).toString('base64url'))

    expect(auth.readSession(raro)).toBeUndefined()
  })

  it('no acepta un payload sin login', async () => {
    const { auth } = makeAuth()

    const sinLogin = sign(
      SECRET,
      Buffer.from(JSON.stringify({ exp: Date.now() + 1_000 })).toString('base64url'),
    )

    expect(auth.readSession(sinLogin)).toBeUndefined()
  })

  it('tolera un payload que no es JSON', async () => {
    const { auth } = makeAuth()

    expect(auth.readSession(sign(SECRET, 'esto-no-es-json'))).toBeUndefined()
  })
})
