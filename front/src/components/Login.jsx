import Logo from './Logo.jsx'

export default function Login({ onLogin, aviso }) {
  return (
    <main className="center">
      <Logo />
      <h1>Sanatorio 42</h1>
      {aviso && <p className="estado aviso">{aviso}</p>}
      <p>¿Te has atascado? Pasa a consulta: aquí siempre hay alguien de guardia. Y si hoy te toca a ti, ponte de guardia y echa una mano.</p>
      <button className="primary" onClick={onLogin}>Entrar con 42</button>
      <section className="howto">
        <h2>Cómo funciona</h2>
        <div className="steps">
          <div className="step-card">
            <span className="step-emoji">🩺</span>
            <strong>1. Cuéntanos qué te duele</strong>
            <p>Elige tu proyecto</p>
          </div>
          <div className="step-card">
            <span className="step-emoji">👀</span>
            <strong>2. Mira quién está de guardia</strong>
            <p>Compañeros disponibles y su puesto</p>
          </div>
          <div className="step-card">
            <span className="step-emoji">🤝</span>
            <strong>3. Ve a su puesto y pide ayuda</strong>
            <p>Nada como explicarlo cara a cara</p>
          </div>
        </div>
      </section>
      <footer className="footer">Sanatorio 42 · Hecho en la Hackathon de 42 Madrid</footer>
    </main>
  )
}
