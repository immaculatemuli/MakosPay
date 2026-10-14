import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorText } from './api';

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

export const Banner = ({ tone = 'warning', children }: { tone?: 'warning' | 'danger' | 'success'; children: ReactNode }) => (
  <div className={`banner ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
    {children}
  </div>
);

export const Loading = () => <p className="muted">Loading…</p>;

export function Failed({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner tone="danger">
      {message}{' '}
      {onRetry && (
        <button className="link" onClick={onRetry}>
          Try again
        </button>
      )}
    </Banner>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="muted">{note}</div>}
    </div>
  );
}

export function Chips<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Badge = ({ tone, children }: { tone?: 'success' | 'danger' | 'warning'; children: ReactNode }) => <span className={`badge ${tone ?? ''}`}>{children}</span>;

/**
 * A pop-up with a title, an explanation, optional fields and one main action. The action shows its own errors,
 * so the office never wonders whether something happened.
 */
export function Dialog({
  title,
  children,
  action,
  actionLabel,
  busyLabel,
  danger,
  disabled,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  action: () => Promise<void>;
  actionLabel: string;
  busyLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The action usually closes the dialog; if it stays open (e.g. it now shows a result), it must be usable again.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (open.current) setError(errorText(err));
    } finally {
      if (open.current) setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog">
        <h1 style={{ fontSize: 20 }}>{title}</h1>
        {children}
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={danger ? 'danger' : ''} onClick={() => void run()} disabled={busy || disabled}>
            {busy ? (busyLabel ?? 'Working…') : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ROLE_WORD: Record<string, string> = { passenger: 'Passenger', conductor: 'Conductor', driver: 'Driver', admin: 'SACCO office', platform_admin: 'Platform admin', system: 'FarePay (automatic)' };

/** Test-money label, shown wherever money appears while Daraja is in sandbox. */
export const TestMoneyBanner = ({ realMoney }: { realMoney: boolean | undefined }) =>
  realMoney === false ? <Banner>Test mode: M-Pesa is in sandbox. No real money moves, and amounts here are test money.</Banner> : null;

/** A password box with a button to show or hide what was typed. */
export function PasswordInput({ value, onChange, autoComplete = 'new-password', ...rest }: { value: string; onChange: (value: string) => void; autoComplete?: string; required?: boolean; 'aria-label'?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password-box">
      <input type={shown ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} {...rest} />
      <button type="button" className="eye" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} title={shown ? 'Hide password' : 'Show password'}>
        {shown ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12 12 0 0 1-3.2 4.2M6.6 6.6C4.5 8 3 10 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        )}
      </button>
    </span>
  );
}
