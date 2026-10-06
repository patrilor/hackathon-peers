import { useState } from 'react'
import { useAuth } from './hooks/useAuth.js'
import Login from './components/Login.jsx'
import ProjectSelect from './components/ProjectSelect.jsx'
import PeerList from './components/PeerList.jsx'
import AvailabilityToggle from './components/AvailabilityToggle.jsx'
import Avatar from './components/Avatar.jsx'
import Logo from './components/Logo.jsx'

/**
 * Lee el error que manda 42 de vuelta al front.
 *
 * Si el permiso se deniega (o el state no cuadra), el back devuelve a casa con
 * `?error=...`. Sin esto, la pantalla de login se ve idéntica a una sesión
 * cancelada por accidente y la persona no sabe qué ha pasado.
 *
 * Se limpia la URL después de leerlo, para que no se repita en cada recarga.
 */
function leerErrorOAuth() {
  const params = new URLSearchParams(window.location.search)
  const codigo = params.get('error')

  if (codigo === null) return null

  params.delete('error')
  params.delete('error_description')
  const query = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)

  if (codigo === 'access_denied') {
    return 'Has cancelado el inicio de sesión. Puedes probar cuando quieras.'
  }

  return `El inicio de sesión con 42 ha fallado (${codigo}). Prueba otra vez.`
}

export default function App() {
  const { me, loading, error, retry, login, logout } = useAuth()
  const [project, setProject] = useState(null)
  const [oauthError] = useState(leerErrorOAuth)

  if (loading) return <p className="center">Cargando...</p>

  // No es que no haya sesión: es que no se ha podido preguntar. Mostrar el login
  // aquí mandaría a la gente a entrar cuando lo que falla es el servidor.
  if (error) {
    return (
      <main className="center">
        <Logo />
        <h1>Sanatorio 42</h1>
        <p className="estado error" role="alert">
          No se puede conectar con el servidor. Puede estar arrancando o haber caído.
        </p>
        <button className="primary" onClick={retry}>Volver a probar</button>
      </main>
    )
  }

  if (!me) return <Login onLogin={login} aviso={oauthError} />

  return (
    <main className="container">
      <header className="topbar">
        <Logo />
        <strong className="brand">Sanatorio 42</strong>
        <Avatar login={me.login} image={me.image} size={40} />
        <span className="login">{me.login}</span>
        <AvailabilityToggle />
        <button onClick={logout}>Salir</button>
      </header>

      {project ? (
        <>
          <button className="link" onClick={() => setProject(null)}>← Volver a la sala de espera</button>
          <PeerList project={project} />
        </>
      ) : (
        <ProjectSelect onSelect={setProject} />
      )}

      <footer className="footer">Sanatorio 42 · Hecho en la Hackathon de 42 Madrid</footer>
    </main>
  )
}
