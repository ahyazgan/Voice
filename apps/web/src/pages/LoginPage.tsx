import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, auth } from '../lib/api.js';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await apiFetch<{ token: string }>('/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      auth.set(token);
      navigate('/calls');
    } catch {
      setError('Parola hatalı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <form className="card" style={{ width: 320 }} onSubmit={submit}>
        <h1 style={{ marginTop: 0, fontSize: 18 }}>Tahsilat Paneli</h1>
        <div className="field">
          <label>Parola</label>
          <input
            className="input"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="state error" style={{ padding: 8 }}>{error}</div>}
        <button className="btn" type="submit" disabled={!password || busy} style={{ width: '100%' }}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş'}
        </button>
      </form>
    </div>
  );
}
