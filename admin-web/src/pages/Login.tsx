import { useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Banner, PasswordInput } from '../ui';
import { passwordHint, passwordOk } from '../password';

/** Office sign-in, and "forgot password" (a 6-digit code by SMS, then a new password). */
export function Login() {
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Forgot password: null = signing in; 'number' = asking for a code; a message = the code was sent.
  const [forgot, setForgot] = useState<null | 'number' | string>(null);
  const [code, setCode] = useState('');

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

  const sendCode = (e: FormEvent) =>
    run(e, async () => {
      const res = await api<{ message: string }>('/auth/password-reset/request', { method: 'POST', body: { phone: phone.trim() } });
      setForgot(res.message);
    });

  const setNew = (e: FormEvent) =>
    run(e, async () => {
      await api('/auth/password-reset/confirm', { method: 'POST', body: { phone: phone.trim(), code: code.trim(), new_password: password } });
      await signIn(phone.trim(), password);
    });

  const phoneField = (
    <label>
      Phone number
      <input type="tel" autoComplete="username" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} required />
    </label>
  );

  return (
    <div className="center-page">
      <form className="card login" onSubmit={(e) => (forgot === null ? run(e, () => signIn(phone.trim(), password)) : forgot === 'number' ? sendCode(e) : setNew(e))}>
        <div className="brand" style={{ padding: 0 }}>
          FarePay
          <small>SACCO office dashboard</small>
        </div>

        {forgot === null && (
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
                  setForgot('number');
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

        {forgot === 'number' && (
          <>
            <p className="muted">Enter your phone number. We send a 6-digit code to it by SMS.</p>
            {phoneField}
            {error && <Banner tone="danger">{error}</Banner>}
            <button type="submit" disabled={busy || phone.trim().length < 9} style={{ width: '100%' }}>
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </>
        )}

        {forgot !== null && forgot !== 'number' && (
          <>
            <Banner tone="success">{forgot}</Banner>
            <label>
              Code from the SMS
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </label>
            <label>
              New password
              <PasswordInput value={password} onChange={setPassword} required />
              <small className="muted">{passwordHint(password)}</small>
            </label>
            {error && <Banner tone="danger">{error}</Banner>}
            <button type="submit" disabled={busy || code.length !== 6 || !passwordOk(password)} style={{ width: '100%' }}>
              {busy ? 'Saving…' : 'Set new password and sign in'}
            </button>
          </>
        )}

        {forgot !== null && (
          <p style={{ textAlign: 'center', marginBottom: 0 }}>
            <button
              type="button"
              className="link"
              onClick={() => {
                setError(null);
                setCode('');
                setForgot(null);
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
