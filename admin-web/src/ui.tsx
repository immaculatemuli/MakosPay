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
