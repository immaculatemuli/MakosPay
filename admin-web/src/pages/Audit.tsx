import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { dateTime } from '../format';
import type { AuditEntry } from '../types';
import { Failed, PageHead, ROLE_WORD } from '../ui';
import { auditLabel } from '../words';

const PAGE = 50;

/** The important values of an entry, short and readable (secrets were never stored). */
const details = (d: AuditEntry['details']) =>
  d
    ? Object.entries(d)
        .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' · ')
    : '';

/** Who did what, newest first. Entries can only be added: nobody can change or delete them. */
export function Audit() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (before: number | null) => {
    setBusy(true);
    try {
      const page = await api<{ items: AuditEntry[]; next_before: number | null }>(`/admin/audit?limit=${PAGE}${before ? `&before=${before}` : ''}`);
      setItems((all) => (before ? [...all, ...page.items] : page.items));
      setNext(page.next_before);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load(null);
  }, []);

  return (
    <>
      <PageHead title="Audit log" subtitle="Who did what, and when. Entries can never be changed or deleted." />
      {error && <Failed message={error} onRetry={() => void load(null)} />}
      {items.length === 0 && !busy && !error && <p className="muted">Nothing recorded yet.</p>}
      {items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateTime(a.created_at)}</td>
                  <td>
                    {a.actor_name ?? ROLE_WORD[a.actor_role] ?? a.actor_role}
                    {a.actor_name && <div className="muted">{ROLE_WORD[a.actor_role] ?? a.actor_role}</div>}
                  </td>
                  <td>
                    {auditLabel(a.action)}
                    {a.entity_id && (
                      <div className="muted">
                        {a.entity} #{a.entity_id}
                      </div>
                    )}
                  </td>
                  <td className="muted" style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>
                    {details(a.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <p>
          <button className="secondary" onClick={() => void load(next)} disabled={busy}>
            {busy ? 'Loading…' : 'Show older'}
          </button>
        </p>
      )}
    </>
  );
}
