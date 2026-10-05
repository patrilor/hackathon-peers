# API de 42 (`api.intra.42.fr`) — Guía completa para el hackatón

Documento de referencia técnica sobre la API pública de 42, verificado contra la API real
usando la aplicación OAuth descrita en la sección [Credenciales](#14-credenciales).

- **Base:** `https://api.intra.42.fr`
- **Versión:** `2.0`
- **Formato:** JSON en entrada y salida, siempre sobre HTTPS
- **Referencia oficial:** <https://api.intra.42.fr/apidoc> (requiere sesión SSO)
- **Documento:** 3 de octubre de 2026

---

## Índice

1. [Conceptos básicos](#1-conceptos-básicos)
2. [Autenticación](#2-autenticación)
3. [Scopes y permisos](#3-scopes-y-permisos)
4. [Parámetros de consulta](#4-parámetros-de-consulta)
5. [Headers de respuesta y caché](#5-headers-de-respuesta-y-caché)
6. [Errores y diagnóstico](#6-errores-y-diagnóstico)
7. [Rate limiting](#7-rate-limiting)
8. [CORS y llamadas desde el navegador](#8-cors-y-llamadas-desde-el-navegador)
9. [Arquitectura recomendada](#9-arquitectura-recomendada)
10. [Catálogo de endpoints](#10-catálogo-de-endpoints)
11. [Esquemas de datos](#11-esquemas-de-datos)
12. [Recetas de datos útiles](#12-recetas-de-datos-útiles)
13. [Clientes de ejemplo](#13-clientes-de-ejemplo)
14. [Credenciales](#14-credenciales)
15. [Checklist de integración](#15-checklist-de-integración)

---

## 1. Conceptos básicos

La API de 42 da acceso programático a los datos de la intranet: perfiles de usuarios,
proyectos, grupos, equipos, logros, coaliciones, eventos, campus, etc.

Reglas de la especificación:

| Regla | Detalle |
|---|---|
| Protocolo | Solo HTTPS. Sin HTTPS la conexión se rechaza. |
| Endpoint actual | `https://api.intra.42.fr/v2` |
| Formato | Todo se envía y se recibe como JSON |
| Campos vacíos | Se incluyen como `null` en lugar de omitirse |
| Timestamps | Siempre ISO 8601 en UTC (`2026-01-26T09:26:47.000Z`) |
| Autenticación | OAuth 2.0 |

> **Consecuencia práctica de la regla de `null`:** nunca asumas que una clave existe. La
> clave está siempre presente pero su valor puede ser `null`. Usa optional chaining
> (`user.phone?.value`) y no `undefined` checks.

### Modelo de datos en una frase

```
Campus ──┬── users
         ├── cursus
         └── events / products / locations / achievements

Cursus ──┬── users      (con nivel y skills)
         ├── skills
         ├── projects
         └── achievements

Projects ──── project_sessions ──── teams ──── users

User ──┬── projects_users  (estado de cada proyecto)
       ├── cursus_users    (nivel + skills con nota)
       ├── achievements
       ├── titles
       ├── groups
       └── locations
```

---

## 2. Autenticación

Usa **OAuth 2.0**. Hay dos flujos. Para un hackatón el primero es casi siempre el
adecuado; el segundo solo si necesitas actuar *en nombre de un usuario concreto*.

### 2.1 Client Credentials (el que necesitas)

Flujo **sin usuario asociado**: la app se autentica como ella misma. Es el más simple.

```
POST https://api.intra.42.fr/oauth/token
```

| Elemento | Valor |
|---|---|
| Método | `POST` |
| Autenticación | `Authorization: Basic base64(UID:SECRET)` |
| `Content-Type` | `application/json` |
| Cuerpo | `{"grant_type": "client_credentials"}` |

#### Con `curl`

```bash
UID="u-s4t2ud-XXXX..."
SECRET="s-s4t2ud-XXXX..."

curl -s -X POST "https://api.intra.42.fr/oauth/token" \
  -u "$UID:$SECRET" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials"}'
```

> `curl -u "$UID:$SECRET"` hace el `base64` por ti. Equivale a
> `-H "Authorization: Basic $(printf '%s:%s' "$UID" "$SECRET" | base64 -w0)"`.

#### Respuesta (verificada)

```json
{
  "access_token": "d7d23ca4...",
  "token_type": "Bearer",
  "expires_in": 7168,
  "scope": "public",
  "created_at": 1791045073,
  "secret_valid_until": null
}
```

| Campo | Significado |
|---|---|
| `access_token` | El token Bearer. Caduca en ~2 horas (≈7168 s). |
| `scope` | Scopes concedidos a **este token**. |
| `secret_valid_until` | Si no es `null`, fecha en la que el Secret se invalida y hay que regenerarlo. |

#### Usar el token

```bash
curl -s "https://api.intra.42.fr/v2/users/albrodri" \
  -H "Authorization: Bearer $TOKEN"
```

Alternativa si no puedes tocar headers (imágenes `<img>`, enlaces, etc.), **no recomendada**:

```
GET /v2/campus/1?access_token=<TOKEN>
```

> Evita `access_token` en la URL: acaba en el historial del navegador, en los logs del
> servidor y en el `Referer` de terceros.

### 2.2 Comprobar tu token

```
GET https://api.intra.42.fr/oauth/token/info
```

Respuesta real de la app del hackatón:

```json
{
  "resource_owner_id": null,
  "scopes": ["public"],
  "expires_in_seconds": 6588,
  "application": {
    "uid": "u-s4t2ud-995431de9983dffdb791636f1ece43dc1338a278cae80ddf7b4647b7b05d496f"
  },
  "created_at": 1791045073
}
```

- `resource_owner_id: null` → confirmas que es un token de **Client Credentials** (no de
  usuario). Si fuera un token de usuario, aquí iría su id.
- `scopes` → comprueba qué tienes realmente. Si añades scopes en el panel, verifica aquí
  que el token nuevo los incluye.

### 2.3 Web Application Flow (Authorization Code)

Es el mecanismo de acceso del hackatón: identifica al usuario que ha iniciado sesión y es
lo que habilita `GET /v2/me`. Ver [§9 Opción C](#opción-c--web-con-login-de-usuario-arquitectura-del-hackatón) para
cómo encaja con el proxy.

#### ⚠️ Tu app nunca ve la contraseña de 42

Esto es lo primero que tienes que tener claro, porque es el error de diseño más común:

> El usuario **sí** escribe su login y su contraseña, pero **en el dominio de 42**
> (`signin.intra.42.fr`), no en tu web. Tu servidor recibe un `code` y un token. Nunca una
> contraseña.

```
 Usuario              Tu backend                    42
   |                      |                          |
   |-- "Entrar con 42" -->|                          |
   |                      |---- redirige ----------->|
   |<-- login + password (dominio 42) ---------------|
   |----- login + password ----------------------->|  <-- la contraseña va a 42, NUNCA a ti
   |<-- 302 a tu redirect_uri con ?code=... --------|  <-- vuelve un código, no la contraseña
   |                      |                          |
   |                      |-- POST /oauth/token ---->|  <-- canje code por token
   |<-- cookie de sesión --|                          |
```

Consecuencias prácticas:

- **Nunca** hagas un formulario que mande `user` y `pass` a tu propio backend. No tienes forma
  de hacerlo: 42 no lo soporta.
- Verificado en la API: `grant_type=password` → `401 unsupported_grant_type`. No existe atajo
  para saltarse el redireccionamiento.
- Tu backend solo necesita el **Client Secret de la app** para canjear el code. Eso es todo.
- Puedes (y debes) usar scopes reducidos: `scope=public` basta para identificar al usuario.

#### Prerrequisitos (configurar **antes** de escribir código)

| # | Acción | Dónde | Urgente |
|---|---|---|---|
| 1 | Añadir el scope `user` a la app | Panel: <https://profile.intra.42.fr/oauth/applications/78735> | Sí, para `/v2/me` |
| 2 | Registrar la `redirect_uri` exacta | Mismo panel | Sí, si no el code nunca vuelve |
| 3 | Desplegar con HTTPS público | Tu hosting | Sí para la demo |
| 4 | Verificar que el Secret sigue igual | `GET /oauth/token/info` | Comprobación |

> ⚠️ **Los pasos 1 y 2 los tienes que hacer tú en el panel de 42.** El panel requiere sesión
> del intra (login de tu cuenta) y no es accesible desde la API: no hay endpoint para
> registrar la `redirect_uri` ni para añadir scopes. Sin el paso 2, el flujo falla aunque el
> código sea perfecto.

Sobre la `redirect_uri`:
- La URL debe coincidir **carácter a carácter** con la registrada. `http://localhost:3000` y
  `https://localhost:3000` son distintas.
- El puerto importa: `http://localhost:3000/auth/callback` ≠ `http://localhost/auth/callback`.
- Puedes registrar varias (una de desarrollo y otra de producción).
- Referencias reales de que funciona: la doc oficial usa `http://localhost:1919/users/auth/ft/callback`
  en su propio ejemplo, y `friends.42paris.fr` usa `https://friends.42paris.fr/auth` en producción.

#### Paso 1 — URL de autorización

```
GET https://api.intra.42.fr/oauth/authorize
```

| Parámetro | Obligatorio | Descripción |
|---|---|---|
| `client_id` | Sí | El UID de tu app |
| `redirect_uri` | Sí | Debe estar registrada. A dónde vuelve el usuario tras autorizar |
| `response_type` | Sí | `code` |
| `scope` | No | Lista separada por espacios. Por defecto vacía |
| `state` | Sí | String aleatorio e impredecible (protección CSRF) |

> **Atajo:** el panel de 42 te da esta URL **ya formateada con tu `client_id`** incluido, en
> la página de tu aplicación. Cópiala de ahí en lugar de construirla a mano y equivocarte en el
> `urlencode`.

Ejemplo (el `redirect_uri` va URL-encoded):

```
https://api.intra.42.fr/oauth/authorize
  ?client_id=u-s4t2ud-...
  &redirect_uri=https%3A%2F%2Ftu-app.com%2Fauth%2Fcallback
  &response_type=code
  &scope=public%20user
  &state=9f8a7b6c5d4e3f21
```

#### Paso 2 — `state`: la protección CSRF

`state` es lo que impide que un atacante te cuele su propio código de autorización. Se
genera antes de redirigir, se guarda en la sesión del visitante, y se compara al volver:

```js
import crypto from 'node:crypto';

// Al redirigir (ruta GET /auth/42)
const state = crypto.randomBytes(24).toString('hex');   // impredecible
req.session.state = state;                                 // guárdalo en servidor

res.redirect(
  'https://api.intra.42.fr/oauth/authorize'
  + `?client_id=${encodeURIComponent(process.env.FORTY_TWO_UID)}`
  + `&redirect_uri=${encodeURIComponent('https://tu-app.com/auth/callback')}`
  + '&response_type=code'
  + '&scope=public%20user'
  + `&state=${state}`
);

// Al volver (ruta GET /auth/callback)
const { code, state } = req.query;
if (!state || state !== req.session.state) {
  return res.status(400).send('state no coincide: posible CSRF');
}
req.session.state = undefined;   // destrúyelo: un state es de un solo uso
```

Dos reglas que no se saltan:
- **`state` se compara con `===` en tiempo constante** y se genera con `crypto`, no con
  `Math.random()`.
- Se **destruye tras usarlo**. Un `state` reutilizable deja la puerta abierta a replay.

#### Paso 3 — Callback: qué puede llegarte

Al `redirect_uri` llegan dos casos, y solo uno es el bueno:

```
?code=ABC123&state=9f8a7b6c5d4e3f21     <-- correcto
?error=access_denied&state=9f8a...      <-- el usuario pulsó "Cancelar"
```

```js
if (req.query.error) {
  // 'access_denied' = el usuario rechazó el consentimiento
  return res.redirect('/?login=cancelado');
}
if (!req.query.code) {
  return res.status(400).send('callback sin code');
}
```

> El usuario ve una pantalla de permisos de 42 y decide. Si acepta, vuelve con el `code`.

#### Paso 4 — Canjear el `code` por un token

Aquí está **la diferencia que más hace tropezar**: este `POST` **no** usa `Authorization:
Basic` como el de Client Credentials. Va **`application/x-www-form-urlencoded`** con
`client_id` y `client_secret` en el cuerpo:

```bash
curl -X POST https://api.intra.42.fr/oauth/token \
  -F client_id='u-s4t2ud-...' \
  -F client_secret='s-s4t2ud-...' \
  -F code='ABC123' \
  -F redirect_uri='https://tu-app.com/auth/callback'
```

Respuesta (difiere de Client Credentials en lo importante):

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "expires_in": 7200,
  "refresh_token": "...",       <-- ¿viene presente? VERIFICAR
  "resource_owner_id": 12345     <-- aquí SÍ tiene valor
}
```

| Campo | Client Credentials | Authorization Code |
|---|---|---|
| `resource_owner_id` | `null` | el id del usuario que autorizó |
| `/v2/me` | `404 {}` | `200` con el perfil |
| `refresh_token` | no | confirmarlo en el primer flujo real |
| Autenticación del cliente | `Authorization: Basic` | `client_id`/`client_secret` en el cuerpo |

En Node:

```js
const res = await fetch('https://api.intra.42.fr/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: process.env.FORTY_TWO_UID,
    client_secret: process.env.FORTY_TWO_SECRET,
    code,
    redirect_uri: 'https://tu-app.com/auth/callback',
  }),
});
if (!res.ok) throw new Error(`canje falló: ${res.status}`);
const tokens = await res.json();
```

> `redirect_uri` del canje debe ser **idéntica** a la de la petición de autorización. Si
> difiere, `invalid_grant`.

Sobre `refresh_token`: el grant **está soportado** por el servidor (verificado: un refresh
falso devuelve `invalid_grant`, no `unsupported_grant_type`). Lo que **no** he podido
confirmar sin completar un login real es si 42 emite el campo en la respuesta. Si viene,
renueva con `grant_type=refresh_token`; si no, obliga a reautorizar cada ~2 h. **Compruébalo
en tu primer flujo y anótalo.**

#### Paso 5 — Identificar al usuario

```bash
curl -H "Authorization: Bearer TOKEN_DE_USUARIO" https://api.intra.42.fr/v2/me
```

Ahora sí responde `200` con el perfil. **Esta llamada es la prueba de que el login funcionó**:
si responde `404 {}`, tu token es de Client Credentials o te falta el scope `user`.

```js
const me = await fetch('https://api.intra.42.fr/v2/me', {
  headers: { Authorization: `Bearer ${userToken}` },
}).then(r => r.json());
// { "id": 12345, "login": "albrodri", "email": "...", ... }
```

#### Sesión: dónde guardar el token

| ❌ Nunca | ✅ Sí |
|---|---|
| `localStorage` (lo lee cualquier XSS) | Cookie `httpOnly` + `secure` + `sameSite=lax` |
| Meter el token de usuario en el HTML | Token **solo** en el servidor |
| Confiar en un `user_id` que manda el cliente | `GET /v2/me` decides quién es |

```js
res.cookie('session', signedSessionId, {
  httpOnly: true,      // invisible a JavaScript
  secure: true,        // solo por HTTPS
  sameSite: 'lax',     // evita CSRF en el callback
  maxAge: 2 * 60 * 60 * 1000,
});
```

El cookie lleva un **identificador de sesión**, no el token. El token de usuario se guarda en
el servidor (base de datos o caché) asociado a ese identificador. Si el cookie es el token
entero, un `httpOnly` ya no te salva de nada.

> Si el usuario ya autorizó tu app antes, se salta la pantalla y reutiliza los scopes del
> último consent. **Cambiar los scopes puede no volver a mostrarte el diálogo**, lo que hace
> muy difícil depurar un `scope` que parece no aplicar. Para forzarlo, prueba con una cuenta
> limpia o revoca el consent en el panel.

---

### 2.4 Librerías que ya hacen el login por ti

Implementar §2.3 a mano son ~80 líneas (state, callback, canje, sesión, logout). Si tu stack
lo tiene, usa un provider probado:

| Librería | Idioma | Notas |
|---|---|---|
| **NextAuth.js** | JS/TS (Next.js) | Provider oficial `42-school`. Si usas Next, es la vía corta |
| **arctic** | JS/TS (cualquier) | Proveedor `FortyTwo`: `createAuthorizationURL()`, `validateAuthorizationCode()` y `refreshToken()` |
| Auth.js / Passport | JS/TS | `passport-42` como estrategia OAuth2 genérica |

Ejemplo con `arctic`, que ya te da el flujo completo:

```js
import * as arctic from 'arctic';

const fortyTwo = new arctic.FortyTwo(UID, SECRET, REDIRECT_URI);

const url = fortyTwo.createAuthorizationURL(state, ['public', 'user']);
// El usuario vuelve a REDIRECT_URI?code=...&state=...

const tokens = await fortyTwo.validateAuthorizationCode(code);
const accessToken = tokens.accessToken();
const user = await fetch('https://api.intra.42.fr/v2/me', {
  headers: { Authorization: `Bearer ${accessToken()}` },
}).then(r => r.json());
```

`arctic` encapsula el canje (incluido el detalle del `Content-Type: form-urlencoded`) y te
devuelve `accessTokenExpiresAt()`, con lo que te ahorras también el cálculo de expiración.

> ⚠️ Comprueba que la librería usa el **form-urlencoded** del Paso 4 y no `Basic`. Es el
> fallo silencioso típico: una librería que manda `Authorization: Basic` recibe
> `401 unsupported_grant_type` y el error apunta a las credenciales, no al formato.

**Decisión práctica:** si el login es una demo de hackatón y no la pieza central del
producto, `arctic` o NextAuth te ahorran el rato. Si lo es, el flujo manual da más control y
está documentado aquí.

---

## 3. Scopes y permisos

Cada app tiene un conjunto de scopes. **Por defecto solo tiene `public`.** Se cambian en
la página de tu aplicación en <https://profile.intra.42.fr/oauth/applications/78735>.

### 3.1 Estado actual de la app del hackatón

| Propiedad | Valor |
|---|---|
| Nombre | `42 Peer Evaluation Analytics` |
| Application ID | `78735` |
| Scopes | `public` **únicamente** |
| Token | Client Credentials (`resource_owner_id: null`) |

**Consecuencia:** todo lo que este documento marca ✅ funciona hoy. Lo marcado 🔒
requiere que añadas scopes en el panel de la aplicación.

#### Configuración que necesita este backend

Lo mínimo para que Sanatorio 42 funcione, y nada más:

| Qué | Valor | Por qué |
|---|---|---|
| Scopes | `public` + **`profile`** | `public` da campus, proyectos y ubicaciones. `profile` es lo único que habilita `/v2/me`. |
| `redirect_uri` de desarrollo | `http://localhost:3000/auth/callback` | Debe coincidir carácter a carácter, puerto incluido. |
| `redirect_uri` de producción | `https://<dominio>/auth/callback` | Sin HTTPS público no hay login en la demo. |
| `User-Agent` | obligatorio | La API responde `403` con el cuerpo vacío si falta. |

Los dos `redirect_uri` pueden registrarse a la vez: el panel acepta varias y se
elige la que corresponda al entorno.

> ⚠️ **El nombre del scope solo lo confirma el panel de tu aplicación.** La tabla de
> §3.2 de este documento es *orientativa* (lo avisa más abajo) y se equivocaba:
> nombraba `user` para el scope de identidad, y en el panel de la app `78735` ese
> scope se llama **`profile`** ("manage user data"). La referencia buena es la
> página de tu propia aplicación, no este documento.

> ⚠️ **`/oauth/authorize` no valida el scope hasta que el usuario se ha autenticado.**
> Se comprobó: pedir `scope=user`, `scope=profile`, un scope inventado o incluso
> `response_type=token` devuelve todos un `302` a `signin.intra.42.fr`. O sea que un
> nombre equivocado **no** falla en la redirección: el usuario escribe su
> contraseña y el error salta después. Por eso el backend no lleva el scope
> hardcodeado, y lo toma de `FORTY_TWO_SCOPES`.

**Estado verificado contra la API** (con token de Client Credentials de la app
`78735`, usando el `RateLimiter` del propio proyecto):

| Endpoint | Resultado |
|---|---|
| `POST /oauth/token` con `client_credentials` | `200`, token correcto |
| `GET /oauth/token/info` | `200`, `"scopes": ["public"]` (esperable en Client Credentials) |
| `GET /v2/users/:login` | `200`, con todos los campos. Trae `location`: puesto actual o `null` |
| `GET /v2/projects` | `200`, **1 702** proyectos |
| `GET /v2/users/:login/projects_users` | `200`. Funciona con `public`: **no hace falta `profile` ni `projects`** |
| `GET /v2/users/:login/locations` | `200`. Por usuario: 0–406 filas según el usuario |
| `GET /v2/me` con token de app | `404 {}` — esperado, no hay `resource_owner_id` |

> ✅ Corregido con la verificación: `projects_users` (la función de "compañeros")
> funciona con el scope `public` de la app. El scope de identidad solo hace falta
> para `/v2/me`, y eso ya lo pedía el login con token de usuario.

> 🚨 **`/v2/campus/22/locations` está descartado.** Devuelve
> `X-Total: 751 077`, o sea **7 511 páginas** de 100. A 550 ms por petición son
> unas 69 minutos, y contra la cuota de 1200/h serían más de seis horas de
> limitador bloqueado y el sincronizador **nunca terminaría**. No es que sea
> lento: es
> que devuelve el *histórico* completo de ubicaciones del campus, no solo las de
> ahora, y no admite filtro para quedarse con las activas
> (`filter[end_at]=nil` responde `422`).
>
> **Qué se usa en su lugar:** el campo `location` de `GET /v2/users/:login`, que
> es el puesto actual (`"c1r2s1"`) o `null` si no está en el campus. Una petición
> por persona y el dato fresco, que es justo lo que hace falta para mostrar "ve a
> su puesto". Descartado también `/v2/users/:login/locations`: funciona, pero
> devuelve el histórico del usuario (0–406 filas según la persona), así que hay
> que filtrar por `end_at: null` para quedarse con una sola.

### 3.2 Mapa de scopes

| Scope | Cubre | Endpoints típicos |
|---|---|---|
| `public` | Datos públicos: campus, cursus, proyectos, skills, logros, títulos, coaliciones, productos | `✅` ya lo tienes |
| `user` | Datos del usuario autenticado y acciones sobre usuarios | `/v2/me` |
| `campus` | Endpoints de campus y sus usuarios | `/v2/campus/:id/...` (los no públicos) |
| `projects` | Datos de proyectos, project_sessions, teams | endpoints de escritura de proyectos |
| `achievements` | Logros y títulos | escritura de logros |
| `coalition` | Coaliciones, scores, dashes | `/v2/coalitions/:id/...` |
| `community` | Comunidades, announcements, subnotions | `/v2/communities` |
| `forum` | Tópicos y mensajes del foro | `/v2/topics`, `/v2/messages` |
| `event` | Eventos e inscripciones | escritura de eventos |
| `product` | Tienda y compras | `/v2/products` (escritura) |
| `location` | Localizaciones de usuarios | escritura de localizaciones |
| `staff` | Datos de staff, exams, admisiones, certificates | endpoints de administración |

> La lista anterior es orientativa y refleja las categorías que usa la 42 en el formulario
> de su panel. La referencia **autoritativa** es la que te muestre tu propia página de
> aplicación. Verifica siempre con `GET /oauth/token/info` tras cambiarlos.

### 3.3 Endpoints que exigen contexto de usuario

Incluso con todos los scopes, algunos endpoints requieren un token **de usuario** (Web
Application Flow), no uno de Client Credentials. En la referencia oficial estos aparecen
marcados con un icono de usuario y devuelven `404` con token de app:

- `GET /v2/me` — "Show the current resource owner"
- `POST /v2/users/:id/correction_points/add`
- `DELETE /v2/users/:id/correction_points/remove`
- `POST /v2/users/:id/set_primary_campus`
- `POST /v2/users/:id/alumnize`

> `GET /v2/me` devolviendo `{}` con `HTTP 404` es el síntoma clásico de que te falta el
> scope `user` **y** el flujo de usuario. No es un bug.

### 3.4 Endpoints restringidos a staff

En la referencia aparecen marcados con un icono de llave (🔑). Necesitan cuenta de staff y
generalmente conexión vía VPN de 42. Con una app de estudiante responden `403`:

```json
{ "error": "Access Denied", "message": "You are not authorized to access this page." }
```

Ejemplos: `/v2/campus/:id/stats`, `/v2/certificates`, `/v2/amendments`, `GET /v2/users/:id/exam`.

### 3.5 Roles de aplicación (`X-Application-Roles`)

Todas las respuestas incluyen una cabecera que hoy te sale vacía:

```
X-Application-Roles: None
```

No es un error: indica que tu app **no tiene ningún rol de aplicación asignado**. Existen
cinco, y el que te interesa es **`Official App`**:

| Rol | Qué te da |
|---|---|
| `Alpha` | Acceso a features inestables |
| `Beta` | Features en beta, para testers del intra |
| **`Official App`** | **App aprobada → te sube el rate limit** |
| `Certified App` | Certificada por un member del staff → más rate limit y más features |
| `Moderator` | Permisos de moderación del foro |

**Por qué importa en un hackatón:** con el rol `None` estás limitado a **2 req/s y 1200
peticiones/hora** (§7). Si vas a extraer datos masivos de toda la red (los ~60 campus, o
todos los usuarios para una analítica), el rate limit es tu cuello de botella real — más
que la API en sí.

Cómo pedirlo: se solicita a **`intrateam@42.fr`** indicando el nombre de la app, el
`Application ID` y el uso académico. No es automático, así que **no lo pongas en el camino
crítico**: úsalo solo si el rate limit te corta, y ten el diseño preparado por si te lo
conceden a tiempo.

---

## 4. Parámetros de consulta

### 4.1 Paginación

Dos sintaxis, ambas soportadas:

```
?page=3&per_page=50          # estilo simple (por defecto 30)
?page[number]=3&page[size]=50  # estilo bracket
```

| Regla | Valor |
|---|---|
| Tamaño por defecto | 30 |
| Tamaño máximo | **100** (pedir más se recorta a 100) |
| Todos los índices | Paginados |

> Verificado: `per_page=500` devuelve `X-Per-Page: 100`.
> Aviso de la doc oficial: "no todos los endpoints pueden llegar a 100" por motivos técnicos.

### 4.2 Filtros

Sintaxis `filter[campo]=valor`, con **múltiples valores separados por comas** y múltiples
campos a la vez:

```
/users?filter[pool_year]=2026&filter[pool_month]=january,february
```

Filtros verificados que funcionan:

| Endpoint | Filtros válidos |
|---|---|
| `/v2/users` | `filter[login]`, `filter[pool_year]`, `filter[pool_month]`, `filter[kind]`, `filter[staff?]` |
| `/v2/campus/:id/users` | `filter[pool_year]`, `filter[pool_month]` |
| `/v2/cursus/:id/users` | `filter[pool_year]`, `filter[pool_month]` |
| `/v2/coalitions` | `filter[cursus_id]` |
| `/v2/achievements` | `filter[tier]`, `filter[kind]` |

**Un filtro inválido da `400`, no un array vacío.** Esto es muy útil para detectar el error:

```json
{
  "error": "Filter Error",
  "message": "Attributes campus_id doesn't exists. You can only filter on: [...]"
}
```

Ojo: `filter[campus_id]` **no existe** en `/v2/users` (el campus se filtra por la ruta
`/campus/:id/users`), y `filter[cursus_id]` **no existe** en `/v2/users` (usa
`/cursus/:id/users`). Filtra por los recursos anidados, no por la clave foránea.

### 4.3 Búsqueda de texto

Parámetro `search`, aunque no aparece en la guía oficial. Verificado:

```
/v2/users?search=albro
/v2/campus/1/users?search=albrodri
```

Busca en nombre, login y email. Es la forma más sencilla de implementar un buscador.

### 4.4 Ordenación

Múltiples campos separados por comas, aplicados en orden. Prefija `-` para descendente:

```
/v2/users?sort=kind,-login       # kind ascendente, luego login descendente
/v2/titles?sort=-name
```

### 4.5 Combinando todo

```
/v2/campus/22/users?filter[pool_year]=2026&filter[pool_month]=january,february&search=al&sort=-login&page=1&per_page=50
```

### 4.6 Endpoint de agregación temporal

```
GET /v2/users/graph/on/:field/by/:interval
```

Agrupar usuarios por un campo a lo largo del tiempo. **Solo admite `created_at` y
`updated_at`**; cualquier otro campo da `422`:

```json
{
  "error": "Graph Error",
  "message": "Attribute pool_month do not exist or isn't graphable. Available fields are: created_at and updated_at"
}
```

---

## 5. Headers de respuesta y caché

```
HTTP/2 200
access-control-allow-credentials: true
access-control-allow-methods: GET, POST, OPTIONS, DELETE, PUT, PATCH
access-control-allow-origin: http://localhost:5173
cache-control: max-age=0, private, must-revalidate
etag: W/"f9a53df8c472aec3071a3ea86cc2f670"
link: <https://api.intra.42.fr/v2/campus/1/users?page=11469&per_page=2>; rel="last", <https://api.intra.42.fr/v2/campus/1/users?page=2&per_page=2>; rel="next"
vary: Origin, Accept-Encoding
x-application-id: 78735
x-application-name: 42 Peer Evaluation Analytics
x-page: 1
x-per-page: 2
x-total: 22938
x-application-roles: None
```

| Header | Para qué sirve |
|---|---|
| `X-Total` | Número **total de páginas**. No el número de elementos. |
| `X-Page` | Página actual |
| `X-Per-Page` | Tamaño de página efectivo (puede ser menor de lo pedido) |
| `Link` | URLs de `first`, `prev`, `next`, `last` |
| `ETag` | Versión del recurso. Weak ETag (`W/"..."`) |
| `Cache-Control` | `max-age=0, private, must-revalidate` → hay que revalidar |
| `X-Application-Id` / `X-Application-Name` | Identifican tu app en cada petición |
| `X-Application-Roles` | Roles de tu app (`None` si no tienes rol) |

> `X-Total` es el número de **páginas**, no de registros. Con `per_page=2` y
> `X-Total: 22938` hay ≈45 876 usuarios. Para el total de registros: `X-Total × X-Per-Page`.

### Caché condicional con ETag

Como `Cache-Control` es `max-age=0`, el navegador y `fetch` **siempre** revalidan. El ETag
te permite responder gratis con un `304`:

```js
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'If-None-Match': etag } });
if (res.status === 304) return cachedBody;   // no se transfirió el body
```

Verificado: enviar `If-None-Match` con el ETag recibido devuelve `304 Not Modified`.
Útil para dashboards que se refrescan cada pocos segundos.

---

## 6. Errores y diagnóstico

| Código | Significado | Causa habitual |
|---|---|---|
| `400` | Petición malformada | Filtro inexistente (`Filter Error`) o campo no ordenable (`Sort Error`) |
| `401` | No autenticado | Token ausente, caducado o malformado |
| `403` | Prohibido | Scope insuficiente, staff-only, **o falta `User-Agent`** |
| `404` | No encontrado | Recurso inexistente, **o ruta no expuesta a tu app** |
| `422` | Entidad no procesable | Parámetro con valor inválido (`Graph Error`) |
| `429` | Rate limit excedido | Más de 2 req/s |
| `500` | Error de servidor | Reintentar más tarde |

### Los tres cuerpos de error con nombre

Cuando la API rechaza un parámetro concreto, el body te dice exactamente qué hacer:

```jsonc
// 400 — el campo de filtro no existe en ese endpoint
{ "error": "Filter Error", "message": "Attributes campus_id doesn't exists. You can only filter on: [...]" }

// 400 — el campo existe pero no admite ordenación
{ "error": "Sort Error", "message": "The score field is not sortable" }

// 422 — el campo existe pero no admite agregación temporal
{ "error": "Graph Error", "message": "Attribute pool_month do not exist or isn't graphable. Available fields are: created_at and updated_at" }
```

El `Graph Error` es especialmente útil: **te lista los campos válidos**. Ante un `400`,
léete el `message` antes de buscar por otro lado.

### ⚠️ El `429` no es JSON

A diferencia del resto de errores, el rate limit responde **texto plano**:

```
HTTP 429 Too Many Requests (Spam Rate Limit Exceeded)
```

No hay `Content-Type: application/json` ni llaves. Si tu cliente hace
`json.loads()` sobre el body de error sin protecciones, **reventará con
`JSONDecodeError` en lugar de devolverte el `429`**, y te parecerá un bug de red.

```python
except urllib.error.HTTPError as e:
    raw = e.read().decode(errors="replace")
    try:
        return e.code, json.loads(raw)
    except json.JSONDecodeError:
        return e.code, {"_raw": raw.strip()}   # 429 y 403 sin body JSON
```

Lo mismo aplica a los `404` de la API, que devuelven una **página HTML**, no JSON. Un
cliente robusto tiene que tratar "el body no es JSON" como un caso normal.

### El `403` con detalle de scope

Cuando falta un scope en una **operación de escritura**, el error viene con el detalle en el
header `WWW-Authenticate` y en el body:

```
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer realm="42 API", error="insufficient scope", error_description="The action need the following scopes: [forum]"

{
  "error": "Forbidden",
  "message": "Insufficient scope. The action need the following scopes: [forum] (Create, update and destroy topics and messages)"
}
```

Esa es la respuesta a localizar cuando algo "no existe": **dice exactamente qué scope falta.**

### El `404` engañoso de 42

La 42 devuelve `404` (no `403`) cuando la ruta existe pero tu app no tiene permiso para
verla. Es la causa número uno de "mi endpoint no funciona":

| Lo que intentas | Lo que pasa realmente |
|---|---|
| `GET /v2/me` | `404 {}` → falta scope `user` + token de usuario |
| `GET /v2/topics/1` | `404` → falta scope `forum` |
| `GET /v2/communities` | `404` → falta scope `community` |
| `GET /v2/campus/1/stats` | `403 Access Denied` → solo staff |

> **Regla práctica:** antes de culpar a la ruta, comprueba `GET /oauth/token/info` y
> confirma que el token es fresco. Si acabas de cambiar scopes, **los tokens ya emitidos
> siguen teniendo los scopes antiguos**: hay que pedir uno nuevo.

### Cuando un `404` es real

También hay `404` legítimos: el recurso no existe. Casos verificados:

- `GET /v2/locations/1` → **`404` con body `{}`**. No es un token caducado ni un scope:
  `locations` **no tiene endpoint `show`**, solo índice. Por eso `GET /v2/locations`
  devuelve una lista plana y no un recurso anidado.
- IDs caducados, slugs mal escritos o recursos que pertenecen a otra red.

> Un `404` con body `{}` (objeto vacío) casi siempre significa **"la ruta no existe para tu
> perfil de app"**, no "el recurso no existe". Un `404` con la página de error HTML de 42
> es el caso contrario: la ruta existe pero el recurso no.

### Errores del flujo OAuth (login)

Errores que verás en el canje del `code` y en el callback. Todos verificados contra la API.

#### `invalid_grant` — el más común

```json
{
  "error": "invalid_grant",
  "error_description": "The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client."
}
```

Es un error **agrupador**: el mensaje no te dice cuál de las cinco causas es. Comprueba en
este orden:

| Causa | Cómo se arregla |
|---|---|
| `code` ya usado | Cada `code` se canjea **una sola vez**. Recargar el callback da error |
| `code` caducado | Son de vida muy corta. Canjea en el momento, sin encolar |
| `redirect_uri` distinta entre los dos pasos | Deben ser **idénticas**, carácter a carácter |
| `code` emitido para otra app | No mezcles el `code` de un entorno con el Secret de otro |
| Revocaste el consent | El usuario tiene que reautorizar |

> **El más desconcertante:** pulsar F5 en la URL del callback da `invalid_grant` aunque el
> login fuera correcto. No es un fallo, es que el `code` ya se consumió. Guarda el resultado
> en sesión **antes** de redirigir.

#### `unsupported_grant_type` — probablemente estás haciendo esto mal

```json
{
  "error": "unsupported_grant_type",
  "error_description": "The authorization grant type is not supported by the authorization server."
}
```

Los grants **que sí** funcionan: `client_credentials`, `authorization_code` y
`refresh_token`. Los que **no** (verificado):

| `grant_type` | Estado |
|---|---|
| `client_credentials` | ✅ El que usas para datos públicos |
| `authorization_code` | ✅ El login de usuario |
| `refresh_token` | ✅ El grant está soportado |
| `password` | ❌ **42 no lo permite.** No puedes pedirle la contraseña a un usuario |

Ese último es el que documenta si alguien intenta el atajo de "login con user y pass"
en vez de redirigir. **No hay forma de hacerlo.** Redirige a `signin.intra.42.fr` (§2.3).

#### `state` no coincide

No viene de la API sino de tu código: `400` en `/auth/callback`. Significa intento de CSRF o
que el usuario abrió dos pestañas de login y la segunda invalidó el `state` de la primera.
No lo relajes comparando: recházalo y regenera.

#### El callback nunca llega

Si el `code` no aparece en tu `redirect_uri`, el problema está **antes** de cualquier código
tuyo. Ordena por probabilidad:

1. `redirect_uri` no registrada en el panel, o no coincide exactamente.
2. HTTPS: si sirves por HTTP, 42 no redirige (salvo en `localhost`).
3. `state` con caracteres problemáticos al viajar en la query string — genera solo hex.
4. El usuario canceló: verás `?error=access_denied` en vez de `?code=`.

---

## 7. Rate limiting

**2 peticiones por segundo** y **1200 por hora**, por aplicación.

Si te pasas:

```
HTTP 429 Too Many Requests (Spam Rate Limit Exceeded)
```

Es la respuesta que verás si haces un bucle de `fetch` en el frontend. **Síntoma típico:**
la primera petición va bien y a partir de la tercera o cuarta todo falla.

> El body es **texto plano, no JSON** (ver [sección 6](#los-tres-cuerpos-de-error-con-nombre)).
> Un cliente que asuma JSON en los errores fallará con `JSONDecodeError` y te hará
> perder tiempo debuggeando la red en lugar de ver el `429`.

Mitigación: **`Retry-After` no viene.** El cliente tiene que hacer backoff por su cuenta
(esperar 0.5–1 s y reintentar con hasta 3 intentos).

### Cómo no comerte el rate limit

```js
// Un solo fetch a la vez, con espera mínima entre peticiones
await new Promise((r) => setTimeout(r, 550));
```

```python
import time
time.sleep(0.55)   # ~2 req/s
```

Recomendaciones para el hackatón:

1. **Cachea en memoria el token** y reutilízalo (~2 h de vida). Renovar token por petición
   te duplica el consumo de rate limit.
2. **Nunca pagines en bucle hasta el final** dentro de una request web. `/campus/1/users`
   son ~23 000 usuarios = ~230 peticiones = tiempo de espera de dos minutos. Trae solo lo
   que la vista necesita con `per_page=100` y filtros.
3. **Precalcula por lotes** fuera del request y guarda el resultado (el backend es el sitio
   correcto para esta lógica: ver [sección 9](#9-arquitectura-recomendada)).
4. Cachea por `ETag` para que el refresco sea `304` y no cuente igual.

---

## 8. CORS y llamadas desde el navegador

La API **refleja cualquier `Origin`** y permite credenciales:

```
access-control-allow-origin: http://localhost:5173
access-control-allow-credentials: true
access-control-allow-methods: GET, POST, OPTIONS, DELETE, PUT, PATCH
access-control-max-age: 1728000
```

Verificado con un `OPTIONS` de preflight desde `http://localhost:5173`: la API responde
`200` con esos headers. Esto significa que **tu frontend puede llamar a la API
directamente**, sin backend.

### Por qué aun así no deberías hacerlo

El flujo `client_credentials` **exige el Client Secret**. Si lo pones en el frontend:

- Queda en el bundle de JS, visible con "ver código fuente".
- Cualquiera que abra la app puede extraerlo y usarlo desde su máquina.
- El Secret es de tu cuenta y 42 puede revocarlo, rompiéndote la app entera.
- El Secret también se registra en los `Referer` si haces peticiones a terceros.

**Conclusión: un proxy backend no es opcional si usas Client Credentials.** Es la única
forma de que el Secret no salga del servidor.

```
❌  Navegador ──── (UID + Secret en el bundle) ────▶ API 42
✅  Navegador ──▶ Tu backend ── (UID + Secret en .env) ──▶ API 42
```

La sección [9](#9-arquitectura-recomendada) tiene un proxy mínimo funcional.

---

## 9. Arquitectura recomendada

### Opción A — Proxy backend (recomendada)

```
┌──────────────┐      ┌─────────────────┐      ┌──────────┐
│  Navegador   │─────▶│  Tu backend     │─────▶│ API 42   │
│  (tu web)    │◀─────│  (.env, Secret) │◀─────│          │
└──────────────┘      └─────────────────┘      └──────────┘
                            │
                            └─▶ caché en memoria: token + respuestas
```

El backend se encarga de: guardar el Secret, cachear el token, cachear respuestas por
ETag, y respetar el rate limit.

#### Proxy mínimo en Node/Express

```js
import express from 'express';
import 'dotenv/config';

const app = express();
const API = 'https://api.intra.42.fr/v2';

let cached = { token: null, expiresAt: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch('https://api.intra.42.fr/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${process.env.FORTY_TWO_UID}:${process.env.FORTY_TWO_SECRET}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`token error ${res.status}`);

  const data = await res.json();
  // Renueva 60 s antes de caducar para no quedarte sin token a mitad de request
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

app.get('/api/campus/:id/users', async (req, res) => {
  const q = new URLSearchParams({
    page: req.query.page ?? '1',
    per_page: req.query.per_page ?? '100',
  });
  const up = await fetch(`${API}/campus/${req.params.id}/users?${q}`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (!up.ok) return res.status(up.status).json(await up.json());
  res.json(await up.json());
});

app.listen(3000);
```

**Dos detalles importantes del código anterior:**

1. **Cachear el token** (`cached`) — sin esto, cada request del navegador pide un token
   nuevo y duplicas el consumo de rate limit.
2. **Renuevar 60 s antes** (`expires_in - 60`) — si no, un token que caduca en mitad de
   una request te da un `401` esporádico imposible de debuggear.

### Opción B — Solo backend (scripts y datos)

Para análisis de datos y scripts el backend es el único actor:

```python
# Python — cliente completo y verificado
import os, time, json, base64, urllib.request, urllib.parse
from dotenv import load_dotenv

load_dotenv()   # sin esto, os.environ["FORTY_TWO_UID"] lanza KeyError

API = "https://api.intra.42.fr/v2"
UID = os.environ["FORTY_TWO_UID"]
SECRET = os.environ["FORTY_TWO_SECRET"]
# OBLIGATORIO: sin User-Agent la API responde 403
UA = {"User-Agent": "hackaton-42442/1.0"}

def get_token() -> str:
    req = urllib.request.Request(
        "https://api.intra.42.fr/oauth/token",
        data=json.dumps({"grant_type": "client_credentials"}).encode(),
        headers={
            "Authorization": "Basic " + base64.b64encode(f"{UID}:{SECRET}".encode()).decode(),
            "Content-Type": "application/json",
            **UA,
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)["access_token"]

TOKEN = get_token()
_last_call = [0.0]

def get(path: str, params: dict | None = None) -> tuple[int, list | dict]:
    # Espera para no superar 2 req/s
    gap = 0.55 - (time.monotonic() - _last_call[0])
    if gap > 0:
        time.sleep(gap)

    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params, safe="[]")
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {TOKEN}", **UA}
    )
    try:
        with urllib.request.urlopen(req) as r:
            _last_call[0] = time.monotonic()
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        _last_call[0] = time.monotonic()
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            # El 429 llega como texto plano, NO como JSON. Sin esto, revienta.
            return e.code, {"_raw": raw.strip()}

def paginate(path: str, params: dict | None = None, per_page: int = 100):
    """Recorre todas las páginas respetando el rate limit (2 req/s)."""
    page = 1
    while True:
        status, data = get(path, {**(params or {}), "per_page": per_page, "page": page})
        if status != 200 or not data:
            return
        yield from data
        page += 1

if __name__ == "__main__":
    status, campus = get("/campus", {"per_page": 100})
    madrid = next(c for c in campus if c["name"] == "Madrid")
    print(f"Madrid: id={madrid['id']}, {madrid['users_count']} usuarios")

    for u in paginate(f"/campus/{madrid['id']}/users", {"filter[pool_year]": "2026"}):
        print(u["login"], u["usual_full_name"])
```

> ⚠️ **Gotcha verificado: sin `User-Agent` la API responde `403 Forbidden`,** incluso con
> credenciales correctas. `requests` y `fetch` lo ponen por defecto; `urllib` **no**, así
> que hay que añadirlo a mano tanto en la petición del token como en las de datos. Es un
> `403` sin cuerpo JSON, fácil de confundir con "scope insuficiente".

### Opción C — Web con login de usuario (arquitectura del hackatón)

Es la opción elegida: login real con 42 + analítica de datos. Encadena el Web Application
Flow (§2.3) en tu backend y guarda el token de usuario **solo en servidor**.

#### Los dos tokens, y cuándo usar cada uno

Aquí está el punto de diseño central: **tu backend maneja dos tokens distintos** y no deben
confundirse.

| | Token de **app** | Token de **usuario** |
|---|---|---|
| Se obtiene con | `grant_type=client_credentials` | `grant_type=authorization_code` |
| Se cachea en | ✅ variable global del servidor | 🔁 por sesión de cada visitante |
| `resource_owner_id` | `null` | el id del usuario que autorizó |
| Sirve para | Catálogos: campus, proyectos, skills, logros | `/v2/me`, y tokenizar la identidad del visitante |
| Caduca cada | ~2 h | ~2 h |
| Quién lo emite | Tu credencial `.env` | El usuario, tras hacer login |

**Regla de oro:** los catálogos públicos se piden siempre con el **token de app** (es el
mismo para todos y se cachea una vez). El **token de usuario** se usa solo para responder
"¿quién es?" y para endpoints que requieren contexto de usuario. Mezclarlos es fácil y
provoca `404` en `/v2/me`.

```
┌─────────────┐    cookie httpOnly     ┌──────────────────┐
│  Navegador  │◀──────────────────────▶│                  │
│  (tu web)   │   (id de sesión,      │   Tu backend     │
└─────────────┘    no el token)        │                  │
                                          │  ┌────────────┐  │
   GET /auth/42 ──────────────────────────▶│  │ sesión →   │  │
                                          │  │ token de   │  │
   ◀── 302 a signin.intra.42.fr ───────────│  │ usuario    │  │
   (el usuario hace login en 42, no aquí)    │  └────────────┘  │
                                          │                  │
   ◀── 302 a /auth/callback?code=... ──────│  canjea code     │
                                          │  (nunca store)   │
                                          │        │         │
   ◀── Set-Cookie: session ────────────────│        │         │
                                          │        ▼         │
   GET /api/me ──────────────────────────▶│  GET /v2/me con │
                                          │  token de usuario│
   ◀── { id, login, email, ... } ─────────│        │         │
                                          │        ▼         │
   GET /api/dashboard ────────────────────▶│  token de APP   │
                                          │  (cacheado)      │
                                          └──────────────────┘
```

#### Las tres rutas que necesitas

```js
// 1. GET /auth/42 — el botón "Entrar con 42"
//    Genera state, lo guarda, redirige a 42. No pide nada al usuario todavía.
app.get('/auth/42', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.state = state;
  res.redirect(
    'https://api.intra.42.fr/oauth/authorize'
    + `?client_id=${encodeURIComponent(process.env.FORTY_TWO_UID)}`
    + `&redirect_uri=${encodeURIComponent(process.env.FORTY_TWO_REDIRECT_URI)}`
    + '&response_type=code&scope=public%20user'
    + `&state=${state}`
  );
});

// 2. GET /auth/callback — vuelve de 42
//    Verifica state, canjea code por token, crea sesión. Requiere cookies (express-session).
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect('/?login=' + encodeURIComponent(error));
  if (!state || state !== req.session.state) return res.status(400).send('state inválido');
  req.session.state = undefined;

  const r = await fetch('https://api.intra.42.fr/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },  // ¡form, no Basic!
    body: new URLSearchParams({
      client_id: process.env.FORTY_TWO_UID,
      client_secret: process.env.FORTY_TWO_SECRET,
      code,
      redirect_uri: process.env.FORTY_TWO_REDIRECT_URI,   // idéntica a la del authorize
    }),
  });
  if (!r.ok) return res.status(502).send('canje falló');

  const tokens = await r.json();

  // El token de usuario NO va al cookie: vive en el servidor, en la sesión.
  req.session.userToken = tokens.access_token;
  req.session.expiresAt = Date.now() + tokens.expires_in * 1000;
  res.redirect('/');   // cookie de sesión httpOnly ya fijada por express-session
});

// 3. GET /auth/logout
app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});
```

#### Expiración del token de usuario

El token de usuario caduca en ~2 h, pero **la sesión vive más**. Cada request autenticada
comprueba el expiry y renueva con `refresh_token` si el grant está disponible (§2.3, Paso 4):

```js
async function getUserToken(req) {
  if (!req.session.userToken) throw new Error('no autenticado');
  if (Date.now() < req.session.expiresAt) return req.session.userToken;

  const r = await fetch('https://api.intra.42.fr/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.FORTY_TWO_UID,
      client_secret: process.env.FORTY_TWO_SECRET,
      grant_type: 'refresh_token',
      refresh_token: req.session.refreshToken,
    }),
  });
  if (!r.ok) throw new Error('refresh falló: reautorizar');   // → redirigir a /auth/42
  const t = await r.json();
  req.session.userToken = t.access_token;
  req.session.refreshToken = t.refresh_token;
  req.session.expiresAt = Date.now() + t.expires_in * 1000;
  return t.access_token;
}
```

> Si resulta que 42 **no** emite `refresh_token`, esta función no puede funcionar y el
> fallback es: al caducar, redirigir a `/auth/42` para reautorizar. Está escrito así a
> propósito. **Confírmalo en tu primer flujo real** (§2.3).

#### Variables de entorno que añade esta opción

No están en tu `.env` actual (que solo cubre Client Credentials). Añádelas cuando
implementes:

| Variable | Para qué |
|---|---|
| `FORTY_TWO_REDIRECT_URI` | La callback; **debe estar registrada en el panel** |
| `SESSION_SECRET` | Firma las cookies de sesión (string largo y aleatorio) |
| `NODE_ENV=production` | Fuerza `secure` y `httpOnly` en las cookies |

> ¿Por qué no las he añadido ya a `.env`? Porque hasta que no elijas tu dominio y la
> desplegues, no existen. Rellénalas el día que las necesites.

#### Lo que el login **no** protege

Aviso importante antes de diseñar la UI. Con el **token de app** (que ya tienes, sin login
nadie) `GET /v2/users/:login` devuelve el perfil completo de **cualquier** usuario: email,
`wallet`, `correction_point` y todas sus notas de proyectos.

Esto significa que **el login identifica al visitante, pero no convierte esos datos en
secretos**. Cualquiera que extraiga tu Client Secret puede leer lo mismo que tu web muestra.
Consecuencias honestas:

- No presentes el login como una barrera de seguridad de datos. Preséntalo como
  *personalización* ("tus notas", "tu progreso").
- Tu backend debe asumir que puede leer datos de cualquier usuario. No construyas nada que
  dependa de que "solo el dueño ve sus datos".
- Lo único que el login protege de verdad es **la identidad**: que el usuario que entra sea
  quien dice ser. Eso ya tiene valor (y es lo que hace fiable un sistema de "mi progreso").

---

## 10. Catálogo de endpoints

Leyenda: ✅ verificado con la app actual (scope `public`) · 🔒 requiere scope adicional ·
🔑 solo staff

### 10.1 Recursos base

| Endpoint | Descripción | Estado |
|---|---|---|
| `GET /v2/campus` | Todos los campus (~60) | ✅ |
| `GET /v2/campus/:id` | Un campus | ✅ |
| `GET /v2/campus/:id/users` | Usuarios del campus (paginado) | ✅ |
| `GET /v2/campus/:id/locations` | Histórico de ubicaciones del campus | ❌ 751 077 filas, inviable |
| `GET /v2/campus/:id/events` | Eventos del campus | ✅ |
| `GET /v2/campus/:id/products` | Productos de la tienda | ✅ |
| `GET /v2/campus/:id/achievements` | Logros del campus | ✅ |
| `GET /v2/campus/:id/stats` | Estadísticas | 🔑 `403` |
| `GET /v2/cursus/:id` | Un cursus (`1` = "42", `21` = "42cursus") | ✅ |
| `GET /v2/cursus/:id/users` | Usuarios del cursus con nivel y skills | ✅ |
| `GET /v2/cursus/:id/skills` | Skills del cursus | ✅ |
| `GET /v2/cursus/:id/projects` | Proyectos del cursus | ✅ |
| `GET /v2/cursus/:id/achievements` | Logros del cursus | ✅ |
| `GET /v2/cursus/:id/users/:login` | Usuario dentro del cursus | 🔒 |

> `GET /v2/cursus` (índice) **no** está expuesto: usa IDs o slugs directos
> (`/v2/cursus/1`, `/v2/cursus/42cursus`).

### 10.2 Usuarios

| Endpoint | Descripción | Estado |
|---|---|---|
| `GET /v2/users` | Todos los usuarios de la red | ✅ |
| `GET /v2/users/:login` | **Perfil completo** con datos anidados | ✅ |
| `GET /v2/users/:login/groups` | Grupos del usuario | ✅ |
| `GET /v2/users/:login/locations` | Localizaciones del usuario | ✅ |
| `GET /v2/users/:login/titles` | Títulos del usuario | ✅ |
| `GET /v2/users/:login/roles` | Roles del usuario | ✅ |
| `GET /v2/me` | Usuario del token | 🔒 necesita scope `user` **y** token de usuario |
| `GET /v2/users/:id/exam` | Estado de examen | 🔑 |
| `GET /v2/users/:id/locations_stats` | Estadísticas de ubicación | 🔑 |
| `POST /v2/users/:id/correction_points/add` | Añadir punto de evaluación | 🔒 token de usuario |

> **El endpoint más útil del hackatón: `GET /v2/users/:login`** devuelve en una sola
> petición el perfil, su progreso real (`projects_users` con `final_mark` y `status`), sus
> skills con notas, sus logros, títulos, campus y grupos. Es la respuesta más rica que
> existe.

> ⚠️ **Y aquí está el matiz de privacidad que conviene tener claro antes de construir la UI.**
> Este endpoint funciona con el **token de app**, sin ningún login. Verificado: devuelve
> `email`, `wallet`, `correction_point` y las 38 notas de proyecto de **cualquier** usuario
> de la red. También sirve como **comprobador de existencia**: login existente → `200`, login
> inexistente → `404 {}`.
>
> Por tanto: el login OAuth sirve para **personalizar** ("tus notas", "tu progreso") y para
> saber **quién** eres, pero **no** es lo que impide leer los datos de otros — eso ya lo
> permite tu Client Secret. Si el diseño depende de que "solo cada quien ve lo suyo", no
> tienes esa garantía. Ver [§9 Opción C](#opción-c--web-con-login-de-usuario-arquitectura-del-hackatón).

### 10.3 Proyectos y grupos

| Endpoint | Descripción | Estado |
|---|---|---|
| `GET /v2/projects` | Todos los proyectos | ✅ |
| `GET /v2/projects/:slug` | Proyecto con `project_sessions` | ✅ |
| `GET /v2/projects/:slug/users` | Usuarios que hicieron el proyecto | ✅ |
| `GET /v2/groups` | Grupos | ✅ |
| `GET /v2/groups/:id` | Grupo | ✅ |
| `GET /v2/groups/:id/users` | Usuarios del grupo | ✅ |
| `GET /v2/projects_sessions` | Índice de project sessions | 🔒 |
| `GET /v2/groups/:id/projects` | Proyectos del grupo | 🔒 |

Filtrar grupos por proyecto funciona: `/v2/groups?filter[team_project]=libft`.

### 10.4 Equipos (teams)

| Endpoint | Descripción | Estado |
|---|---|---|
| `GET /v2/teams` | Equipos | ✅ |
| `GET /v2/teams/:id` | Equipo con `repo_url`, `status`, `final_mark` | ✅ |
| `GET /v2/teams/:id/users` | Miembros del equipo | ✅ |

Un `team` es el grupo de personas que hace un `project_session` concreto. Contiene datos
muy interesante para el hackatón:

- `repo_url` / `repo_uuid` — acceso al repo Vogsphere del equipo
- `final_mark` — nota final (es el dato de peer evaluation)
- `status` (`in_progress`, `finished`, `validated`…)
- `project_gitlab_path` — ruta del proyecto en GitLab

### 10.5 Logros, títulos y coaliciones

| Endpoint | Descripción | Estado |
|---|---|---|
| `GET /v2/achievements` | Logros | ✅ |
| `GET /v2/achievements/:id` | Un logro | ✅ |
| `GET /v2/achievements/:id/users` | Usuarios que lo volvieron | ✅ |
| `GET /v2/titles` | Títulos | ✅ |
| `GET /v2/titles/:id/users` | Usuarios con ese título | ✅ |
| `GET /v2/coalitions` | Coaliciones | ✅ |
| `GET /v2/coalitions/:id/users` | Usuarios de la coalición | ✅ |
| `GET /v2/coalitions/:id/achievements` | Logros de coalición | 🔒 |
| `GET /v2/patronages` | Padrinazgos | ✅ |
| `GET /v2/skills` | Skills | ✅ |
| `GET /v2/languages` | Idiomas | ✅ |
| `GET /v2/roles` | Roles | ✅ |
| `GET /v2/products` | Tienda | ✅ |
| `GET /v2/events` | Eventos | ✅ |
| `GET /v2/locations` | Localizaciones | ✅ |

> `GET /v2/locations/:id` devuelve `{}`: **locations solo tiene índice**, no detalle.

### 10.6 Recursos bloqueados

Estos existen en la API pero responden `404` con la app actual:

| Endpoint | Scope necesario |
|---|---|
| `GET /v2/topics`, `/v2/topics/:id`, `/v2/topics/:id/messages` | `forum` |
| `GET /v2/messages` | `forum` |
| `POST /v2/topics/:id/messages` | `forum` (escritura) |
| `GET /v2/communities`, `/v2/communities/:id/users` | `community` |
| `GET /v2/campus/:id/communities` | `community` |
| `GET /v2/informations` | `community` |
| `GET /v2/dons` | `dons` |
| `GET /v2/spotlights` | `community` |
| `GET /v2/apps`, `/v2/apps/:id` | `user` |
| `GET /v2/staff` | `staff` |

### 10.7 Catálogo oficial completo

La referencia de 42 documenta muchos más recursos. La mayoría requieren scopes
adicionales, pero esta es la lista completa para saber qué existe:

Accreditations · Achievements · Achievements users · Announcements · Anti grav units ·
Anti grav units users · Apps · Attachments · Balances · Bloc deadlines · Blocs ·
Broadcasts · Campus · Campus users · Campus users activities · Certificates ·
Certificates users · Closes · Coalitions · Coalitions users · Commands · Community
services · Cursus · Cursus users · Dashes · Dashes users · Endpoints · Evaluations ·
Events · Events users · Expertises · Flags · Flash users · Flashes · Groups · Groups
users · Internships · Languages · Languages users · Scores · Skills · Slots · Squads ·
Subnotions · Tags · Teams · Teams uploads · Teams users · Titles · Titles users ·
Transactions · Translations · User candidatures · Users · Waitlists

Patrón muy útil de la API: `GET /v2/{recurso}/:id/users` existe para casi todos —
`achievements`, `titles`, `groups`, `teams`, `projects`, `coalitions`, `events`,
`campus`, `cursus`, `communities`, `dashes`, `partnerships`, `accreditations`,
`expertises`, `quests`.

---

## 11. Esquemas de datos

Todos los campos existen siempre; los no aplicables vienen como `null`.

### User

Obtenido con `GET /v2/users/:login`.

```jsonc
{
  "id": 254645,
  "login": "albrodri",
  "email": "albrodri@student.42madrid.com",
  "first_name": "Alberto José",
  "last_name": "Rodríguez Díaz",
  "usual_full_name": "Alberto José Rodríguez Díaz",
  "usual_first_name": "Alberto José",
  "displayname": "Alberto José Rodríguez Díaz",
  "kind": "student",              // "student" | "alumnus" | "staff" | "school_manager" | ...
  "url": "https://api.intra.42.fr/v2/users/albrodri",
  "phone": "hidden",              // puede ser "hidden" si el campus lo oculta
  "image": {
    "link": "https://cdn.intra.42.fr/users/.../albrodri.gif",
    "versions": { "large": "...", "medium": "...", "small": "...", "micro": "..." }
  },
  "active?": true,
  "staff?": false,
  "alumni?": false,
  "alumnized_at": null,
  "anonymize_date": null,
  "data_erasure_date": null,
  "pool_month": "January",        // mes de la piscina
  "pool_year": 2026,
  "correction_point": 0,          // wallet en Evaluation Points
  "wallet": 0,
  "created_at": "2026-01-26T09:25:46.612Z",
  "updated_at": "2026-09-30T...",
  "location": null,               // ubicación actual (¡solo si está dentro!)
  "campus": [ /* objetos campus */ ],
  "campus_users": [ /* ver abajo */ ],
  "cursus_users": [ /* ver abajo */ ],
  "projects_users": [ /* ver abajo */ ],
  "groups": [],
  "achievements": [ /* ver abajo */ ],
  "titles": [ /* ver abajo */ ],
  "titles_users": [],
  "languages_users": [],
  "expertises_users": [],
  "roles": [],
  "partnerships": [],
  "patroned": [],
  "patroning": []
}
```

### User embebido (en índices)

`GET /v2/users`, `/campus/:id/users` y `/cursus/:id/users` devuelven una versión **reducida**
sin los arrays anidados:

```
id, login, email, first_name, last_name, usual_full_name, usual_first_name, displayname,
kind, url, phone, image, active?, staff?, alumni?, alumnized_at, anonymize_date,
data_erasure_date, pool_month, pool_year, correction_point, wallet, location,
created_at, updated_at
```

> **Optimización clave:** para listados (cards, tablas, rankings) usa los índices con
> `per_page=100`; solo llama a `/users/:login` para el detalle. Así consumes 1 request en
> lugar de 100.

### projects_user — el estado de un proyecto

```jsonc
{
  "id": 5118770,
  "occurrence": 0,
  "status": "in_progress",   // "in_progress" | "finished" | "validated" | "waiting_for_scale" | "unstarted" | "done"
  "validated?": null,        // tri-state: true / false / null
  "final_mark": null,        // nota final (float) — el dato clave
  "marked": false,
  "marked_at": null,
  "current_team_id": 7682520,
  "retriable_at": null,
  "created_at": "...",
  "updated_at": "...",
  "project": { "id": 2689, "name": "Call Me Maybe", "slug": "call-me-maybe", "parent_id": null },
  "cursus_ids": [21]
}
```

> **La nota no siempre es sobre 100.** `occurrence` indica la repetición del proyecto
> (0 = primera vez). Cuando hay varias ocurrencias, 42 **escala la nota y puede superar
> 100**: en datos reales de `albrodri` la máxima de sus 38 proyectos con nota es **125**.
> Si haces rankings o medias, no asumas la escala 0–100.
>
> Ojo también con `occurrence > 0`: un mismo `project` aparece **repetido**, una entrada por
> intento. Para "última nota" coge la de mayor `occurrence`, no la primera que te devuelva
> la API.

### cursus_user — nivel y skills

```jsonc
{
  "id": 366232,
  "begin_at": "2026-01-26T09:26:47.000Z",
  "end_at": "2026-02-20T17:00:00.000Z",
  "grade": "Pisciner",      // Pisciner | Student | Junior | Intermediate | Advanced | Explorer | Expert
  "level": 7.49,            // nivel de 42 (sube con la xp)
  "skills": [
    { "id": 4, "name": "Unix", "level": 8.19 },
    { "id": 1, "name": "Algorithms & AI", "level": 5.9 }
  ]
}
```

> **Idea directa para el hackatón:** `cursus_users[].skills[].level` es la progresión
> real del usuario. Un radar de skills sale de aquí sin calcular nada.

### campus_user

```jsonc
{
  "id": 247458,
  "user_id": 254645,
  "campus_id": 22,          // 22 = Madrid
  "is_primary": true,
  "created_at": "...",
  "updated_at": "..."
}
```

> **IDs de campus útiles:** `1` Paris, `22` Madrid, `42` 42Network, `58` Barcelona,
> `2` Lisboa, `9` Beirut… Se obtienen de `GET /v2/campus`.

### Achievement

```jsonc
{
  "id": 40,
  "name": "404 - Sleep not found",
  "description": "Logged for 24h straight",
  "tier": "easy",             // "none" | "easy" | "medium" | "hard" | "insane"
  "kind": "scolarity",        // "project" | "scolarity" | "alumni" | "staff" | "pedagogical" | ...
  "visible": true,
  "image": "/uploads/achievement/image/40/SCO001.svg",
  "nbr_of_success": null,
  "users_url": "https://api.intra.42.fr/v2/achievements/40/users",
  "achievements": [],         // logros hijos (anidados)
  "campus": ["Madrid", "Paris", ...],  // nombres, NO ids
  "parent": null,
  "title": null
}
```

> Ojo: en `achievement.campus` es un array de **nombres** (strings), mientras que en
> `project.campus` es un array de **objetos campus**. No es uniforme: comprueba el tipo.

### Title

```jsonc
{ "id": 1328, "name": "%login, Writer's soul" }
```

> Lleva un marcador `%login` que 42 sustituye por el login del usuario al renderizar.

### Skill

```jsonc
{ "id": 1, "slug": "algorithms-ai", "name": "Algorithms & AI", "created_at": "..." }
```

### Language

```jsonc
{ "id": 11, "identifier": "es", "name": "Spanish" }
```

### Role

```jsonc
{ "id": 1, "name": "Student", "description": "..." }
```

### Cursus

```jsonc
{
  "id": 21,
  "name": "42cursus",
  "slug": "42cursus",
  "kind": "main",             // "main" | "main_deprecated" | "piscine" | "exam" | "integration" | ...
  "created_at": "2019-07-29T08:45:17.896Z"
}
```

> IDs: `1` = "42" (`kind: "main_deprecated"`, el inicial), `21` = "42cursus"
> (`kind: "main"`, el actual), `42` = "42Network".

### Campus

```jsonc
{
  "id": 22,
  "name": "Madrid",
  "city": "Madrid",
  "country": "Spain",
  "address": "...",
  "zip": "28013",
  "time_zone": "Europe/Madrid",      // útil para mostrar horas locales
  "email_extension": "42madrid.com",
  "language": { "id": 11, "name": "Spanish", "identifier": "es", ... },
  "users_count": 13856,
  "vogsphere_id": 48,
  "website": "https://42madrid.com/",
  "facebook": "...",
  "twitter": "...",
  "active": true,
  "public": true,
  "default_hidden_phone": true
}
```

### Project

```jsonc
{
  "id": 1,
  "name": "Libft",
  "slug": "libft",              // el slug es lo que usas en la URL
  "difficulty": 100,
  "parent": null,
  "children": [],
  "attachments": [],            // vídeos, PDFs, enlaces del proyecto
  "exam": false,
  "git_id": null,
  "repository": null,
  "created_at": "...",
  "updated_at": "...",
  "cursus": [ /* 3 objetos cursus */ ],
  "campus": [ /* 58 objetos campus */ ],
  "videos": [],
  "project_sessions": [ /* ver abajo — el richest part */
}
```

> `GET /v2/projects/libft` devuelve ~58 objetos campus y 10 project_sessions completos:
> puede pesar **varios cientos de KB**. Para listados, no llames al detalle de cada
> proyecto.

### ProjectSession

```jsonc
{
  "id": 16050,
  "solo": true,                    // ¿individual o en equipo?
  "begin_at": null,                // null = ventana abierta (tipo Libft)
  "end_at": null,
  "estimate_time": "7 days",
  "difficulty": 100,
  "objectives": ["Basics of C programming", "Unix C library", ...],
  "description": "...",
  "duration_days": null,
  "terminating_after": 42,          // días hasta que caduca
  "max_people": null,
  "is_subscriptable": true,
  "team_behaviour": "user",         // "user" | "team"
  "commit": null,
  "project_id": 1,
  "campus_id": 1,
  "cursus_id": 10,
  "created_at": "...",
  "updated_at": "...",
  "scales": [                       // las evaluaciones (peer reviews) posibles
    { "id": 10104, "correction_number": 5, "is_primary": true },
    { "id": 1, "correction_number": 5, "is_primary": false }
  ],
  "uploads": [
    { "id": 70, "name": "Moulinette" },
    { "id": 165, "name": "Pandora" }
  ]
}
```

> `project_sessions` está embebido dentro del proyecto, no hay endpoint `show` propio en el
> scope actual. `terminating_after` es lo que te dice si un proyecto "caduca" y con eso
> puedes construir una vista de "proyectos por terminar".

### Group

```jsonc
{ "id": 690, "name": "albrodri's group" }
```

### Team

```jsonc
{
  "id": 7682520,
  "name": "albrodri's group",
  "url": "https://api.intra.42.fr/v2/teams/7682520",
  "final_mark": null,               // nota final del equipo
  "status": "in_progress",
  "project_id": 2689,
  "project_session_id": 16050,
  "project_gitlab_path": "pedago_world/42-cursus/inner-circle/call-me-maybe",
  "repo_url": "git@vogsphere-v2.42madrid.com:vogsphere/intra-uuid-...-albrodri",
  "repo_uuid": "intra-uuid-a201a4a6-6478-4e21-9a43-77a9e29e1e16-7682520-albrodri",
  "locked?": true,
  "validated?": null,
  "closed?": false,
  "locked_at": "...",
  "closed_at": null,
  "terminating_at": null,
  "created_at": "...",
  "updated_at": "...",
  "users": [ /* objetos user completos */ ],
  "scale_teams": [],
  "teams_uploads": []
}
```

### Coalition

```jsonc
{
  "id": 618,
  "name": "Babyfoot",
  "slug": "babyfoot",
  "image_url": "https://cdn.intra.42.fr/coalition/image/618/logo_coa_babyfoot.svg",
  "cover_url": "https://cdn.intra.42.fr/coalition/cover/618/coa__1_.png",
  "color": "#0E12B5",             // ideal para el tema visual de la vista
  "score": 11172,                 // puntos acumulados
  "user_id": 128811               // bocal
}
```

> `coalition.color` es un hex directo: úsalo para pintar la %). Perfecto para un
> leaderboard por coalición.

### Event

```jsonc
{
  "id": 44291,
  "name": "🚀 Presentación NASA Space Apps Challenge 2026",
  "description": "Acogemos en **Studio 42 Madrid** ...",   // Markdown
  "location": "Studio 42",
  "kind": "event",                 // "event" | "examen" | "reunion" | "hackathon" | ...
  "max_people": 0,                 // 0 = sin límite
  "nbr_subscribers": 0,
  "begin_at": "2026-11-13T16:30:00.000Z",
  "end_at": "2026-11-13T17:30:00.000Z",
  "campus_ids": [22],
  "cursus_ids": [21],
  "prohibition_of_cancellation": null,
  "waitlist": null,
  "themes": [],
  "created_at": "...",
  "updated_at": "..."
}
```

> `description` viene en **Markdown**: renderízalo como tal, pero sanea el HTML si muestras
> contenido de terceros.

### Product

```jsonc
{
  "id": 1,
  "name": "Bocal dedicated tee-shirt",
  "description": "...",
  "price": 100,
  "quantity": null,
  "begin_at": null,
  "end_at": null,
  "category_id": 4,
  "kind": "manager",
  "slug": "bocal-dedicated-tee-shirt",
  "image": {
    "url": "/uploads/product/image/1/bocal_dedicated.jpg",
    "thumb": { "url": "/uploads/product/image/1/thumb_bocal_dedicated.jpg" }
  },
  "is_uniq": true,
  "one_time_purchase": false,
  "created_at": "...",
  "updated_at": "..."
}
```

> `image.url` es **relativa** (`/uploads/...`). Hay que prefixarla con
> `https://api.intra.42.fr`. En cambio `image.link` de los usuarios y `coalition.image_url`
> ya son URLs absolutas.

### Location

```jsonc
{
  "id": 12345,
  "campus_id": 22,
  "user": { /* objeto user embebido */ },
  "host": "Cluster 1 - pc-42mad-01",
  "primary": true,
  "begin_at": "2026-10-03T08:00:00.000Z",
  "end_at": null                    // null = sigue presente
}
```

> **Esto es una lista de presencia en tiempo real.** `end_at: null` = el usuario sigue
> dentro. Con esto se construye easily un mapa "quién está en el campus ahora".
> **Solo está disponible con scope `user`** para el detalle del usuario.

### Patronage

```jsonc
{
  "id": 789,
  "user_id": 254645,
  "user": { /* user */ },
  "godfather_id": 254645,
  "godfather": { /* user */ },
  "ongoing": false,
  "created_at": "...",
  "updated_at": "..."
}
```

---

## 12. Recetas de datos útiles

Ideas concretas que salen directamente de lo que ofrece la API con el scope actual.

### Notas de proyectos (el "core" de la app)

```
GET /v2/users/:login
```

→ `projects_users[].final_mark` y `projects_users[].status`.

Un leaderboard de notas por proyecto sale de: recorrer `/v2/projects/:slug/users` (o mejor,
`/v2/users?filter[pool_year]=2026`) y cruzar con `projects_users`.

```python
def progress(login: str) -> list[dict]:
    """Todos los intentos, con la nota de la última repetición de cada proyecto."""
    _, user = get(f"/users/{login}")

    # occurrence > 0 = reintentos. Conserva el mayor occurrence por proyecto.
    latest: dict[str, dict] = {}
    for p in user["projects_users"]:
        slug = p["project"]["slug"]
        if slug not in latest or p["occurrence"] > latest[slug]["occurrence"]:
            latest[slug] = p

    return [
        {
            "project": p["project"]["slug"],
            "name": p["project"]["name"],
            "mark": p["final_mark"],          # puede ser null (sin nota aún) o > 100
            "status": p["status"],
            "attempts": sum(
                1 for q in user["projects_users"] if q["project"]["slug"] == slug
            ),
        }
        for p in latest.values()
    ]
```

Salida real para `albrodri`: **40 intentos**, 38 de ellos con nota.

### Radar de skills

```
GET /v2/users/:login
```

→ `cursus_users[].skills[].level`. Devuelve `[{id, name, level}]` listo para radar.

### Títulos conseguidos

```
GET /v2/users/:login
```

→ `titles`. Recuerda sustituir `%login` en el nombre.

### Logros con su comunidad

```
GET /v2/achievements?filter[kind]=alumni&per_page=100
GET /v2/achievements/:id/users          # quién lo tiene
```

Cada logro trae `users_url` listo para consultar.

### Coaliciones con su color y score

```
GET /v2/coalitions?filter[cursus_id]=21&per_page=100
GET /v2/coalitions/:id/users
```

> ⚠️ **`score` NO es ordenable en el servidor.** `?sort=-score` devuelve
> `400 {"error":"Sort Error","message":"The score field is not sortable"}`.
> Ordénalo en cliente:
>
> ```python
> _, coalitions = get("/coalitions", {"filter[cursus_id]": 21, "per_page": 100})
> ranking = sorted(coalitions, key=lambda c: -(c["score"] or 0))
> ```
>
> Los scores son enteros grandes (a fecha de este doc, el top de Madrid es
> `Supernova` con 1 419 603 puntos, muy por encima de los miles que devuelve el índice
> global). Descargar las coalitions **de una vez** y ordenar en cliente: cabe de sobra en
> memoria y te ahorra muchas peticiones.

### Presencia en el campus ahora mismo

```
GET /v2/campus/22/locations?per_page=100
```

Filtra `end_at == null` para saber quién sigue dentro.

### Stats de un campus

```
GET /v2/campus
```

→ `users_count` de cada campus, sin pagar una request por campus. Para un mapa de calor de
la red.

### Eventos próximos

```
GET /v2/campus/22/events?per_page=100
```

Ordena por `begin_at` en cliente y quédate con los futuros.

### Fetcher JS con token cacheado

```js
let token = null;
let tokenUntil = 0;

async function api42(path, params = {}) {
  if (!token || Date.now() > tokenUntil) {
    const res = await fetch('https://api.intra.42.fr/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${import.meta.env.VITE_UID}:${import.meta.env.VITE_SECRET}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    });
    if (!res.ok) throw new Error('No se pudo obtener el token');
    const data = await res.json();
    token = data.access_token;
    tokenUntil = Date.now() + (data.expires_in - 60) * 1000;
  }

  const url = new URL('https://api.intra.42.fr/v2' + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API 42: ${res.status} ${await res.text()}`);
  return res.json();
}
```

> ⚠️ Este snippet **solo para prototyping local**. `import.meta.env.VITE_*` se inyecta en
> el bundle público: el Secret queda expuesto. Para la versión final, muévelo al backend
> (§9).

---

## 13. Clientes de ejemplo

Los tres snippets completos verificados durante la redacción de este documento están en:

- **Proxy backend Node/Express** → [sección 9, Opción A](#opción-a--proxy-backend-recomendada)
- **Cliente Python con paginación y rate limit** → [sección 9, Opción B](#opción-b--solo-backend-scripts-y-datos)
- **Fetcher JS con token cacheado** → [sección 12](#fetcher-js-con-token-cacheado)

### Cargar el `.env`

```bash
pip install python-dotenv
npm install dotenv        # para Node
```

```python
from dotenv import load_dotenv
load_dotenv()             # lee .env automáticamente
```

En Node 20+ también funciona sin dependencia:

```bash
node --env-file=.env app.js
```

### `.env`

Ya creado en el proyecto, con las 10 variables de la [sección 14](#14-credenciales).
Copia `.env.example` a `.env` para recrearlo en otro entorno.

### Script de comprobación

Para verificar que todo funciona de un vistazo:

```python
import os, time, json, base64, urllib.request
from dotenv import load_dotenv
load_dotenv()

UA = {"User-Agent": "hackaton-42442/1.0"}
h = {
    **UA,
    "Authorization": "Basic " + base64.b64encode(
        f"{os.environ['FORTY_TWO_UID']}:{os.environ['FORTY_TWO_SECRET']}".encode()
    ).decode(),
    "Content-Type": "application/json",
}
res = urllib.request.urlopen(urllib.request.Request(
    "https://api.intra.42.fr/oauth/token",
    data=json.dumps({"grant_type": "client_credentials"}).encode(),
    headers=h,
))
token = json.load(res)["access_token"]
info = json.load(urllib.request.urlopen(urllib.request.Request(
    "https://api.intra.42.fr/oauth/token/info",
    headers={"Authorization": f"Bearer {token}", **UA},
)))
print(f"Scopes: {info['scopes']}  (expira en {info['expires_in_seconds']} s)")

for path in ["/campus/22", "/users/albrodri", "/cursus/21/skills", "/coalitions"]:
    req = urllib.request.Request(
        f"https://api.intra.42.fr/v2{path}",
        headers={"Authorization": f"Bearer {token}", **UA},
    )
    with urllib.request.urlopen(req) as r:
        print(f"{r.status} {path}")
    time.sleep(0.55)
```

Salida esperada:

```
Scopes: ['public']  (expira en 6588 s)
200 /campus/22
200 /users/albrodri
200 /cursus/21/skills
200 /coalitions
```

> ⚠️ **Ejecuta el script desde la raíz del proyecto** (`python3 check.py` con el cwd en
> la carpeta que contiene `.env`). `load_dotenv()` busca el fichero subiendo desde el
> **directorio del script**, no desde el cwd, así que si lo mueves a `/tmp` o a otra
> carpeta recibirás `KeyError: 'FORTY_TWO_UID'`. Para que el directorio no influya, pásalo
> explícito: `load_dotenv(dotenv_path="/ruta/absoluta/al/.env")`.

---

## 14. Credenciales

La aplicación OAuth del hackatón está registrada en
<https://profile.intra.42.fr/oauth/applications/78735>.

| Propiedad | Valor |
|---|---|
| Nombre | `42 Peer Evaluation Analytics` |
| Application ID | `78735` |
| Scopes | `public` — **falta añadir `user`** para el login |
| Tipo de uso | Client Credentials + Authorization Code |
| `redirect_uri` | **Sin registrar.** Se añade al implementar el login (§2.3) |
| Rol de aplicación | `None` → sin subida de rate limit (§3.5) |

Las credenciales están en `.env` (ignorado por git). Copia `.env.example` a `.env` para
recrearlas en otro entorno.

### Variables que añadirá el login

Las de arriba cubren Client Credentials. Cuando implementes el flujo de usuario (§2.3 /
§9 Opción C) necesitarás tres más. **No están en tu `.env` actual** a propósito: hasta que
no exista tu dominio no se pueden rellenar.

| Variable | Para qué | Ejemplo |
|---|---|---|
| `FORTY_TWO_REDIRECT_URI` | La callback del login | `https://tu-app.com/auth/callback` |
| `SESSION_SECRET` | Firma las cookies de sesión | string largo y aleatorio |
| `NODE_ENV` | Endurece las cookies en producción | `production` |

```bash
# Copia .env.example, y tras desplegar añade:
FORTY_TWO_REDIRECT_URI=https://tu-app.com/auth/callback
SESSION_SECRET=  # genera con: openssl rand -base64 48
```

> ⚠️ `FORTY_TWO_REDIRECT_URI` **debe coincidir exactamente** con la registrada en el panel
> de 42, y ese registro tienes que hacerlo tú (no hay endpoint para ello).

### ⚠️ Seguridad

1. **El Client Secret es una credencial real.** No lo subas a git, no lo pegues en un
   slide, no lo metas en el bundle del navegador.
2. `.gitignore` ya incluye `.env`. Si alguna vez lo comiteaste por error, **rota el secret**
   en el panel de 42 (se regenera y rompe todas las copias).
3. Si vas a pedir más scopes, recuerda que **cambiar scopes no rota el Secret**: solo
   invalida tokens futuros. Los tokens ya emitidos siguen con los scopes antiguos.
4. Con el flujo de usuario, **el Client Secret sigue siendo tuyo** y se usa en el canje del
   `code`. Sigue sin poder ir al navegador.
5. El **token de usuario** es de la persona que autoriza. Trátalo como dato personal: no lo
   registres en logs, no lo devuelvas en la API de tu propia web.
6. El login no protege los datos públicos de otros usuarios ([§10.2](#102-usuarios)). No
   construyas la UI prometiendo que sí.
7. Estas credenciales son personales y de uso académico. Para una app pública, cambia a un
   flujo de usuario.

---

## 15. Checklist de integración

### Antes de escribir código

- [ ] `.env` existe con `FORTY_TWO_UID` y `FORTY_TWO_SECRET`
- [ ] `.env` está en `.gitignore`
- [ ] `GET /oauth/token/info` devuelve `"scopes": ["public"]`
- [ ] El Secret **no** va en el frontend

**Bloqueantes del login (hazlos en el panel de 42, no hay API para esto):**

- [ ] Scope `user` añadido a la app
- [ ] `redirect_uri` registrada, **carácter a carácter** como la vas a usar
- [ ] `redirect_uri` en HTTPS (o `localhost` si aún no has desplegado)
- [ ] Comprobado que **cambiar scopes no te dejó sin token**: `GET /oauth/token/info` otra vez

### Al implementar

- [ ] Token cacheado en el servidor, no solicitado por petición
- [ ] Renovado 60 s antes de caducar
- [ ] `User-Agent` enviado (obligatorio con `urllib`)
- [ ] Rate limit respetado: máx. 2 req/s (`sleep 0.55`)
- [ ] `per_page=100` en listados; índices en vez de N llamadas al detalle
- [ ] Paginación leída con `X-Total` / `Link`
- [ ] Campos tratados como posiblemente `null`
- [ ] Manejo de `400` (filtro inválido), `403` (scope), `404` (ruta bloqueada), `429`

**Login (§2.3):**

- [ ] `state` generado con `crypto` (nunca `Math.random()`), guardado en sesión
- [ ] `state` comparado en el callback y **destruido** tras usarlo
- [ ] `error=access_denied` gestionado (el usuario canceló)
- [ ] Canje con `Content-Type: application/x-www-form-urlencoded`, **no** `Basic`
- [ ] `redirect_uri` idéntica en el paso de authorize y en el canje
- [ ] Resultado guardado **antes** de redirigir (F5 en el callback da `invalid_grant`)
- [ ] `GET /v2/me` responde `200` con el token de usuario
- [ ] Token de usuario en el servidor; en la cookie solo el **id de sesión**
- [ ] Cookie `httpOnly` + `secure` + `sameSite=lax`; nada de token en `localStorage`
- [ ] Anotado si 42 emite `refresh_token` (decide si hay que reautorizar cada 2 h)
- [ ] Token de app para catálogos, token de usuario solo para identidad

### Antes de enseñar

- [ ] `image.url` de productos prefixada con `https://api.intra.42.fr`
- [ ] Fechas formateadas en la zona horaria del campus (`campus.time_zone`)
- [ ] `description` de eventos renderizado como Markdown saneado
- [ ] Secret no visible en el código fuente del frontend
- [ ] Rate limit no agotado durante la demo (¡pruébalo antes!)
- [ ] Login probado con una **cuenta limpia** (si ya autorizaste, 42 se salta la pantalla
      y no ves si los scopes se aplican bien)
- [ ] Probado en móvil y con el **corte de red** a mitad de la demo