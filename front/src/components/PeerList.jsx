import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/index.js'
import Avatar from './Avatar.jsx'

// 0: especialista de guardia · 1: paciente como tú de guardia
// 2: especialista que no está de guardia · 3: paciente como tú que no está de guardia
// "De guardia" siempre significa available: true y location distinta de null.
function onDuty(peer) {
  return peer.available && peer.location != null
}

function rank(peer) {
  const specialist = peer.status === 'finished'
  if (onDuty(peer) && specialist) return 0
  if (onDuty(peer)) return 1
  if (specialist) return 2
  return 3
}

/**
 * Normaliza lo que devuelve `getPeers`.
 *
 * El back devuelve `{ peers, total, partial }` (el total vive en la cabecera
 * `X-Total-Participants` y el estado de la descarga en `X-Partial`), y el mock
 * devuelve la lista tal cual, como dice `docs/api.md`. De aquí sale lo mismo
 * para los dos, y el resto del componente no se entera de cuál es cuál.
 */
function normalizar(respuesta) {
  if (Array.isArray(respuesta)) {
    return { peers: respuesta, total: respuesta.length, partial: false }
  }

  return {
    peers: respuesta.peers ?? [],
    total: respuesta.total ?? undefined,
    partial: respuesta.partial === true,
  }
}

export default function PeerList({ project }) {
  const [peers, setPeers] = useState([])
  const [total, setTotal] = useState(undefined)
  const [partial, setPartial] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'finished' | 'in_progress'
  const [onlyOnDuty, setOnlyOnDuty] = useState(false)
  const [groupTherapyOpen, setGroupTherapyOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { peers: lista, total: totalParticipantes, partial: quedanPaginas } = normalizar(
        await api.getPeers(project.id),
      )
      setPeers(lista)
      setTotal(totalParticipantes)
      setPartial(quedanPaginas)
    } catch (err) {
      setError(err?.network === true ? err.message : `No se pudieron cargar (${err.message}).`)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    setPeers([])
    setTotal(undefined)
    setPartial(false)
    setTypeFilter('all')
    setOnlyOnDuty(false)
    setGroupTherapyOpen(false)
    setCopied(false)
    cargar()
  }, [cargar])

  if (loading) return <p>Cargando compañeros...</p>

  if (error) {
    return (
      <section>
        <h2>Quién te puede atender en {project.name}</h2>
        <p className="estado error">{error}</p>
        <button className="pill" onClick={cargar}>Volver a probar</button>
      </section>
    )
  }

  const onDutyCount = peers.filter(onDuty).length
  const onDutySpecialists = peers.filter((p) => onDuty(p) && p.status === 'finished').length
  const sorted = [...peers].sort((a, b) => rank(a) - rank(b))

  const byDuty = onlyOnDuty ? sorted.filter(onDuty) : sorted
  const specialistsCount = byDuty.filter((p) => p.status === 'finished').length
  const inProgressCount = byDuty.filter((p) => p.status === 'in_progress').length
  const filtered =
    typeFilter === 'all' ? byDuty : byDuty.filter((p) => p.status === typeFilter)

  const badge = (peer) => {
    if (!onDuty(peer)) return <span className="badge off">Fuera de turno</span>
    return <span className="badge on">De guardia</span>
  }

  const inProgressOnDuty = peers.filter((p) => onDuty(p) && p.status === 'in_progress')
  const meetupSpot = inProgressOnDuty.find((p) => p.location)?.location

  const copyLogins = async () => {
    await navigator.clipboard.writeText(inProgressOnDuty.map((p) => p.login).join(' '))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const statusTag = (peer) => {
    if (peer.status === 'finished') {
      return <span className="badge specialist">★ Especialista</span>
    }
    return <span className="badge subtle">Paciente como tú</span>
  }

  return (
    <section>
      <h2>Quién te puede atender en {project.name}</h2>
      {onDutyCount > 0 ? (
        <p className="count">
          {onDutyCount === 1 ? '1 de guardia' : `${onDutyCount} de guardia`} ahora mismo
          {onDutySpecialists > 0 && (
            <> ({onDutySpecialists === 1 ? '1 especialista' : `${onDutySpecialists} especialistas`})</>
          )}
        </p>
      ) : (
        <p className="count">Hoy no hay nadie de guardia en este proyecto. ¿Y si te pones tú?</p>
      )}
      {peers.length > 0 && (
        <p className="total">
          {total !== undefined && total > peers.length
            ? `${peers.length} de ${total} participantes pueden atenderte ahora mismo.`
            : `${peers.length === 1 ? '1 persona' : `${peers.length} personas`} pueden atenderte ahora mismo.`}
        </p>
      )}
      {partial && (
        <p className="total aviso">
          Estamos bajando la lista poco a poco (la API de 42 va despacio) y aún faltan personas.
          Vuelve a entrar en un rato y habrá más.
        </p>
      )}
      {peers.length === 0 && <p>Ahora mismo no hay nadie en este turno... pero puedes volver a preguntar más tarde.</p>}
      <div className="filters">
        <div className="filter-pills">
          {[
            ['all', `Todos (${byDuty.length})`],
            ['finished', `Especialistas (${specialistsCount})`],
            ['in_progress', `Pacientes como tú (${inProgressCount})`],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill ${typeFilter === value ? 'active' : ''}`}
              onClick={() => setTypeFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="duty-check">
          <input
            type="checkbox"
            checked={onlyOnDuty}
            onChange={(e) => setOnlyOnDuty(e.target.checked)}
          />
          Solo de guardia
        </label>
      </div>
      {filtered.length === 0 && peers.length > 0 && (
        <p>Ahora mismo no hay nadie así de guardia. Prueba con otro filtro</p>
      )}
      {inProgressOnDuty.length >= 2 && (
        <div className="group-therapy">
          <p>
            Hay {inProgressOnDuty.length} pacientes con tu misma dolencia de guardia. ¿Iniciáis terapia de grupo?
          </p>
          {!groupTherapyOpen && (
            <button className="pill active" onClick={() => setGroupTherapyOpen(true)}>
              Iniciar terapia de grupo
            </button>
          )}
          {groupTherapyOpen && (
            <>
              <ul className="group-therapy-list">
                {inProgressOnDuty.map((p) => (
                  <li key={p.login}>
                    <Avatar login={p.login} image={p.image} size={28} />
                    <strong>{p.login}</strong>
                  </li>
                ))}
              </ul>
              <p>Quedad en {meetupSpot}</p>
              <button className="pill" onClick={copyLogins}>
                {copied ? '¡Copiados!' : 'Copiar logins'}
              </button>
            </>
          )}
        </div>
      )}
      <ul className="peer-list">
        {filtered.map((peer) => (
          <li key={peer.login} className="peer-card">
            <Avatar login={peer.login} image={peer.image} />
            <div>
              <strong>{peer.login}</strong>
              <p>{peer.location ? `Te atiende en ${peer.location}` : 'Fuera del centro'}</p>
              {statusTag(peer)}
            </div>
            {badge(peer)}
            <a
              className="profile-link"
              href={`https://profile.intra.42.fr/users/${peer.login}`}
              target="_blank"
              rel="noreferrer"
            >
              Ver perfil
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
