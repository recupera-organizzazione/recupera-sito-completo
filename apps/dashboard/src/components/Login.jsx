import { useState } from 'react';
import { login } from '../lib/api.js';
import { STR } from '../lib/strings.js';

// Pagina di accesso operatori — unico gate verso la dashboard.
// Nessuna credenziale nel frontend: verifica via POST /auth/login,
// token di sessione in sessionStorage (cfr. src/lib/api.js).
export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const me = await login(username.trim(), password);
      onLoggedIn(me);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-screen rc-grid-bg">
      <form className="login-card" onSubmit={handleSubmit} aria-label={STR.login.title}>
        <p className="eyebrow">{STR.login.eyebrow}</p>
        <h1>{STR.login.title}</h1>
        <p className="login-subtitle">{STR.login.subtitle}</p>

        <label className="field-label" htmlFor="login-username">
          {STR.login.username}
        </label>
        <input
          id="login-username"
          className="login-input"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <label className="field-label" htmlFor="login-password">
          {STR.login.password}
        </label>
        <input
          id="login-password"
          className="login-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button className="primary-button login-submit" type="submit" disabled={busy}>
          {busy ? STR.login.submitting : STR.login.submit}
        </button>

        <p className="login-hint">{STR.login.hint}</p>
      </form>
    </div>
  );
}
