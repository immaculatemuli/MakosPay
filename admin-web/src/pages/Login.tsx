import { useState, type FormEvent } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { Banner, PasswordInput } from '../ui';

/** Office sign-in. A forgotten password is set again by the SACCO office. */
export function Login() {
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  const run = async (e: FormEvent, action: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const phoneField = (
    <label>
      Phone number
      <input type="tel" autoComplete="username" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} required />
    </label>
  );

  return (
    <div className="center-page">
      <form className="card login" onSubmit={(e) => run(e, () => signIn(phone.trim(), password))}>
        <div className="brand" style={{ padding: 0 }}>
          FarePay
          <small>SACCO office dashboard</small>
        </div>

        {!forgot && (
          <>
            <p className="muted">Sign in with the office phone number and password you use in the FarePay app.</p>
            {phoneField}
            <label>
              Password
              <PasswordInput autoComplete="current-password" value={password} onChange={setPassword} required />
            </label>
            {error && <Banner tone="danger">{error}</Banner>}
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p style={{ textAlign: 'center' }}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setError(null);
                  setPassword('');
                  setForgot(true);
                }}
              >
                Forgot password?
              </button>
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Passengers, conductors and drivers use the FarePay phone app. You stay signed in for 12 hours on this computer.
            </p>
          </>
        )}

        {forgot && <Banner>Ask the SACCO office to set a new password for you, then sign in with it. Whoever runs FarePay can help if nobody in the office can sign in.</Banner>}

        {forgot && (
          <p style={{ textAlign: 'center', marginBottom: 0 }}>
            <button
              type="button"
              className="link"
              onClick={() => {
                setError(null);
                setForgot(false);
              }}
            >
              Back to sign in
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
