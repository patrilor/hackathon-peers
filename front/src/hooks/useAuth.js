import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/index.js'

/**
 * Quién hay en sesión, con la distinción que importa.
 *
 * `error` solo se llena cuando el problema es de red (back caído, timeout): un
 * 401 no es un error, es que no ha entrado nadie, y corresponde a la pantalla de
 * login. Mezclar los dos hacía que un corte del backend se pareciera a un
 * "no estás registrado".
 */
export function useAuth() {
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setMe(await api.getMe())
    } catch (err) {
      setMe(null)
      // 401 = no hay sesión: es la respuesta normal de un navegador recién
      // abierto. Todo lo demás (sin red, back caído, 500) sí es un fallo que
      // conviene enseñar en vez de esconderlo detrás del login.
      const esFalloDeServidor = err?.network === true || (err?.status ?? 401) !== 401
      setError(esFalloDeServidor ? (err.message ?? 'Error inesperado') : null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = async () => {
    await api.login()
    await refresh()
  }

  const logout = async () => {
    await api.logout()
    setMe(null)
  }

  return { me, loading, error, login, logout, retry: refresh }
}