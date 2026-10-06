import { useEffect, useState } from 'react'
import { api } from '../api/index.js'

export default function AvailabilityToggle() {
  // Arranca en false y se hidrata después. Antes se leía en el inicializador del
  // useState, que solo funciona con el mock: `mockApi.getAvailability` devuelve
  // un booleano de golpe, pero contra la API real devuelve una Promise, y una
  // Promise es truthy. Con eso la casilla salía siempre marcada y el toggle
  // estaba roto (`!next` sobre una Promise da false).
  const [available, setAvailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aviso, setAviso] = useState(null)

  useEffect(() => {
    let vigente = true

    // `Promise.resolve` primero porque el mock es síncrono y la API real no:
    // encadenar la llamada dentro de la cadena deja el mismo código para los dos
    // modos. Si se hiciera `api.getAvailability().then(...)`, en modo mock
    // `.then` se llamaría sobre un booleano y reventaría.
    Promise.resolve()
      .then(() => api.getAvailability())
      .then((guardando) => {
        if (vigente) setAvailable(guardando === true)
      })
      .catch(() => {
        // Si no se puede leer, se deja en false. Es el mismo criterio del back:
        // quien no ha marcado nunca no está de guardia.
      })

    // Si el componente se desmonta antes de responder, se ignora el resultado.
    return () => {
      vigente = false
    }
  }, [])

  const toggle = async () => {
    const next = !available
    setAvailable(next)
    setSaving(true)
    setAviso(null)

    try {
      await api.setAvailability(next)
    } catch {
      // Se revierte y se avisa: dejar el interruptor en un estado que la base no
      // tiene haría que al recargar vuelva a estar apagado sin motivo.
      setAvailable(!next)
      setAviso('No se ha podido guardar. Prueba otra vez.')
      setTimeout(() => setAviso(null), 4000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="switch-wrap">
    <label className="switch-row">
      <span>De guardia</span>
      <input type="checkbox" className="switch" checked={available} onChange={toggle} disabled={saving} />
      <span
        className="duty-info"
        tabIndex={0}
        role="img"
        aria-label="Solo aparecerás de guardia cuando estés en el campus"
        data-tooltip="Solo aparecerás de guardia cuando estés en el campus"
      >
        ⓘ
      </span>
    </label>
    {aviso && (
      <span className="estado error switch-aviso" role="status">
        {aviso}
      </span>
    )}
    </span>
  )
}
