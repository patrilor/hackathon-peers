import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/index.js'

const EMOJIS = {
  ft_printf: '🖨️',
  get_next_line: '🧵',
  push_swap: '🔀',
}

const emojiFor = (name) => EMOJIS[name] ?? '🩺'

export default function ProjectSelect({ onSelect }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setProjects(await api.getMyProjects())
    } catch (err) {
      setError(err?.network === true ? err.message : `No se pudieron cargar tus proyectos (${err.message}).`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  if (loading) return <p>Cargando proyectos...</p>

  if (error) {
    return (
      <section>
        <h2>¿Qué te duele hoy?</h2>
        <p className="estado error">{error}</p>
        <button className="pill" onClick={cargar}>Volver a probar</button>
      </section>
    )
  }

  return (
    <section>
      <h2>¿Qué te duele hoy?</h2>
      {projects.length === 0 && (
        <p className="estado">
          No tienes proyectos en curso. ¡Buen momento para descansar! Si acabas de empezar uno, vuelve
          en unos minutos y aparecerá aquí.
        </p>
      )}
      <ul className="project-list">
        {projects.map((p) => (
          <li key={p.id}>
            <button className="project" onClick={() => onSelect(p)}>
              <span className="emoji">{emojiFor(p.name)}</span>
              {p.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}