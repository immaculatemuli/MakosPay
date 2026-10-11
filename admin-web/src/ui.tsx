import type { ReactNode } from 'react';

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

/** Test-money label, shown wherever money appears while Daraja is in sandbox. */
export const TestMoneyBanner = ({ realMoney }: { realMoney: boolean | undefined }) =>
  realMoney === false ? <Banner>Test mode: M-Pesa is in sandbox. No real money moves, and amounts here are test money.</Banner> : null;
