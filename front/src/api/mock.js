// Datos mock con EXACTAMENTE el formato de docs/api.md.
// Se usan mientras VITE_USE_MOCK=true.

const ME = { login: 'plopez-l', image: 'https://cdn.intra.42.fr/users/plopez-l.jpg' }

const PROJECTS = [
  { id: 1314, name: 'ft_printf' },
  { id: 1337, name: 'get_next_line' },
  { id: 1420, name: 'push_swap' },
]

const PEERS = {
  1314: [
    { login: 'jdoe', image: 'https://cdn.intra.42.fr/users/jdoe.jpg', location: 'c2r4s6', available: true, status: 'finished' },
    { login: 'mgarcia', image: 'https://cdn.intra.42.fr/users/mgarcia.jpg', location: 'c1r2s1', available: false, status: 'in_progress' },
    { login: 'anavarro', image: 'https://cdn.intra.42.fr/users/anavarro.jpg', location: 'c1r2s4', available: true, status: 'in_progress' },
    { login: 'llorente', image: 'https://cdn.intra.42.fr/users/llorente.jpg', location: 'c5r3s2', available: true, status: 'in_progress' },
    { login: 'rtoledo', image: 'https://cdn.intra.42.fr/users/rtoledo.jpg', location: null, available: false, status: 'finished' },
  ],
  1337: [
    { login: 'lruiz', image: 'https://cdn.intra.42.fr/users/lruiz.jpg', location: 'c3r1s9', available: true, status: 'in_progress' },
    { login: 'jdoe', image: 'https://cdn.intra.42.fr/users/jdoe.jpg', location: null, available: false, status: 'in_progress' },
    { login: 'gmoreno', image: 'https://cdn.intra.42.fr/users/gmoreno.jpg', location: 'c1r5s7', available: true, status: 'in_progress' },
    { login: 'mgarcia', image: 'https://cdn.intra.42.fr/users/mgarcia.jpg', location: 'c2r7s3', available: true, status: 'finished' },
    { login: 'ksayago', image: 'https://cdn.intra.42.fr/users/ksayago.jpg', location: null, available: true, status: 'finished' },
    { login: 'vserrano', image: 'https://cdn.intra.42.fr/users/vserrano.jpg', location: null, available: false, status: 'finished' },
  ],
  1420: [
    { login: 'mgarcia', image: 'https://cdn.intra.42.fr/users/mgarcia.jpg', location: 'c2r7s3', available: true, status: 'in_progress' },
    { login: 'tvega', image: 'https://cdn.intra.42.fr/users/tvega.jpg', location: 'c3r4s5', available: true, status: 'in_progress' },
    { login: 'cfernandez', image: 'https://cdn.intra.42.fr/users/cfernandez.jpg', location: 'c4r2s8', available: true, status: 'finished' },
    { login: 'iturralde', image: 'https://cdn.intra.42.fr/users/iturralde.jpg', location: null, available: true, status: 'finished' },
    { login: 'dpena', image: 'https://cdn.intra.42.fr/users/dpena.jpg', location: null, available: false, status: 'finished' },
  ],
}

const loggedKey = 'mock_logged_in'
const availableKey = 'mock_available'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

function isLoggedIn() {
  const stored = localStorage.getItem(loggedKey)
  if (stored !== null) return stored === 'true'
  return import.meta.env.VITE_MOCK_LOGGED_IN === 'true'
}

export const mockApi = {
  async getMe() {
    await delay()
    if (!isLoggedIn()) {
      const err = new Error('No session')
      err.status = 401
      throw err
    }
    return ME
  },

  login() {
    // En la API real esto redirige; en mock simplemente iniciamos sesión
    localStorage.setItem(loggedKey, 'true')
    return Promise.resolve()
  },

  async logout() {
    await delay()
    localStorage.removeItem(loggedKey)
  },

  async getMyProjects() {
    await delay()
    return PROJECTS
  },

  async getPeers(projectId) {
    await delay()
    // Devuelve la lista tal cual, como dice `docs/api.md`. El total y el estado
    // de descarga solo existen en la API real (viven en las cabeceras), y
    // `PeerList.normalizar` los rellena con la longitud de esta lista.
    return PEERS[projectId] ?? []
  },

  async setAvailability(available) {
    await delay()
    localStorage.setItem(availableKey, String(available))
    return { available }
  },

  getAvailability() {
    return localStorage.getItem(availableKey) === 'true'
  },
}
