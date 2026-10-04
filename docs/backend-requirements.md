# Requisitos del backend

Documento para quien desarrolle el backend (o para su asistente de IA). Explica cómo está montado el frontend y qué necesita del back para funcionar sin cambios.

El formato exacto de cada endpoint está en [`docs/api.md`](api.md). Si hace falta cambiar algo del contrato, se acuerda con el equipo y se actualiza ese archivo antes de programarlo.

## Cómo está montado el frontend

- React + Vite, dentro de `front/`.
- Todas las llamadas al back están en `front/src/api/`. Los componentes no llaman al back directamente.
- La URL del back se configura en `front/.env` con `VITE_API_URL` (por ejemplo, `http://localhost:3000`).
- Con `VITE_USE_MOCK=true`, el front usa datos de prueba con el mismo formato que `docs/api.md`. Para usar el back real: `VITE_USE_MOCK=false`.
- Las peticiones se hacen con `fetch` y `credentials: 'include'`: la sesión viaja en una cookie que pone el back.
- Todas las respuestas deben ser JSON.
- El front está publicado en https://sanatorio-42.vercel.app (se actualiza solo con cada cambio en `main`).

## Endpoints que necesita el front

| Método | Ruta | Uso en el front |
|---|---|---|
| GET | `/auth/login` | El botón "Entrar con 42" navega aquí. Debe redirigir al login de la intra de 42 (OAuth). |
| GET | `/auth/callback` | Uso interno del back: recibe el código de 42, crea la sesión y redirige a la URL del front. |
| GET | `/auth/me` | Al cargar la web. Devuelve el usuario logueado, o **401** si no hay sesión (así el front sabe que debe mostrar el login). |
| POST | `/auth/logout` | Botón "Salir". Cierra la sesión. |
| GET | `/me/projects` | Pantalla "¿Qué te duele hoy?": proyectos **en curso** del usuario. |
| GET | `/projects/:id/peers` | Lista de compañeros y especialistas de ese proyecto. |
| PUT | `/me/availability` | Interruptor "De guardia". Body: `{ "available": true }`. |

## Requisitos de los datos

- **`image`**: debe ser un texto con la URL de la foto. La API de 42 devuelve la foto como un objeto con varios tamaños: hay que extraer una URL y devolverla como texto. Si no hay foto, `null` (el front muestra la inicial).
- **`location`**: el puesto del cluster como texto (por ejemplo `"c2r4s6"`), o `null` si la persona no está conectada en el campus.
- **`/projects/:id/peers`**: solo personas del **campus de Madrid** que tengan ese proyecto **en curso** o que ya lo hayan **aprobado**. No incluir al propio usuario.
- **`status`**: `"in_progress"` si la persona está haciendo el proyecto; `"finished"` si ya lo ha terminado y aprobado. Quienes lo han aprobado son los "especialistas": el front los destaca porque son quienes más pueden ayudar.
- **`available`**: la API de 42 no tiene este dato. El back debe guardarlo él mismo (base de datos o, como mínimo, en memoria) y devolverlo en cada compañero.
- **`id`** de los proyectos: el id del proyecto en la API de 42.

## Regla de guardia

En Sanatorio 42 la ayuda es cara a cara: una persona solo cuenta como "de guardia" si tiene `available: true` **y** está en el campus (`location` distinta de `null`). Esta regla la aplica el front, así que el back solo tiene que devolver `available` y `location` tal cual.

## Especialistas: cuidado con el tamaño de la lista

En los proyectos más comunes, cientos de personas pueden haberlos aprobado. Para que la lista sea útil y la API de 42 no se sature, se recomienda devolver solo los especialistas que estén **en el campus** (`location` distinta de `null`). Las personas con el proyecto en curso se devuelven siempre.

## Sesión, cookies y CORS

Si front y back están en direcciones distintas (por ejemplo, puertos distintos), el back debe:

- Permitir CORS desde la dirección exacta del front (no `*`), y con credenciales (`Access-Control-Allow-Credentials: true`).
- Configurar la cookie de sesión para que el navegador la envíe en esas peticiones.

Sin esto, el login parecerá funcionar pero `/auth/me` devolverá siempre 401.

## API de 42

- El client ID y el client secret van **solo** en el `.env` del back, nunca en el código ni en el front. Añadir los nombres de las variables (sin valores) a `.env.example`.
- La API de 42 limita el número de peticiones: conviene guardar los resultados en caché unos minutos.
- Documentación: https://api.intra.42.fr/apidoc

## Cómo comprobar que todo encaja

1. Arrancar el back.
2. En `front/.env`: `VITE_USE_MOCK=false` y `VITE_API_URL` con la URL del back.
3. Arrancar el front (`cd front && npm run dev`) y comprobar:
   - Sin sesión aparece el login, y "Entrar con 42" lleva a la intra.
   - Tras el login se ven tus proyectos en curso.
   - Al elegir un proyecto se ven compañeros con foto, puesto y estado, y los especialistas destacados.
   - El interruptor "De guardia" se mantiene al recargar la página.
   - "Salir" vuelve al login.
## Despliegue

**Decidido: Oracle Cloud Always Free + Caddy + UptimeRobot.**

| Pieza | Qué aporta |
|---|---|
| Oracle Cloud Always Free | 4 ARM y 24 GB de RAM, gratis y sin tarjeta. |
| Caddy | Reverse proxy con TLS automático, sin-renewar certificados a mano. |
| UptimeRobot | Avisa si `/health` deja de responder. |

Se descartaron Fly.io y Render porque el plan gratuito se queda corto o duerme
justo cuando hay demo. Google Cloud e2-micro es la alternativa si no hay cuenta
en Oracle: más caro y con más de configurar.

Lo que falta antes de poder cerrar el punto 9:

1. Una IP o dominio público, para registrar `https://<dominio>/auth/callback` en el
   panel de 42.
2. El scope `user` aprobado en la app `78735`.
3. Las mismas variables de entorno en el servidor, con el `.env` en modo `600`.

El arranque en el servidor es el de siempre: `npm ci`, `npm run build`,
`npm start`, y systemd o un `pm2` para que sobreviva a un reinicio.
