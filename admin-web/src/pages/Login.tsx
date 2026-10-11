import { useState, type FormEvent } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { Banner } from '../ui';

export function Login() {
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(phone.trim(), password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <form className="card login" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          FarePay
          <small>SACCO office dashboard</small>
        </div>
        <p className="muted">Sign in with the office phone number and password you use in the FarePay app.</p>
        <label>
          Phone number
          <input type="tel" autoComplete="username" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <Banner tone="danger">{error}</Banner>}
        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted" style={{ marginBottom: 0 }}>
          Passengers, conductors and drivers use the FarePay phone app. You stay signed in for 12 hours on this computer.
        </p>
      </form>
    </div>
  );
}
