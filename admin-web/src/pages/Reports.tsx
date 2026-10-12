import { useState } from 'react';
import { api } from '../api';
import { dateTime, displayPhone, kes } from '../format';
import type { ProblemReport } from '../types';
import { Badge, Chips, Dialog, Failed, Loading, PageHead, ROLE_WORD } from '../ui';
import { useApi } from '../useApi';
import { REPORT_CATEGORY, REPORT_STATUS } from '../words';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'New' },
  { value: 'in_progress', label: 'Being looked into' },
  { value: 'resolved', label: 'Resolved' },
];
const STATUSES = [
  { value: 'in_progress', label: 'Being looked into' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'open', label: 'New (reopen)' },
] as const;

/** Problems reported by passengers and crew; the office replies (the reporter sees the reply in the app). */
export function Reports() {
  const [filter, setFilter] = useState('');
  const { data, error, loading, reload } = useApi<ProblemReport[]>(`/admin/reports${filter ? `?status=${filter}` : ''}`);
  const [reply, setReply] = useState<ProblemReport | null>(null);
  const [status, setStatus] = useState<'open' | 'in_progress' | 'resolved'>('in_progress');
  const [note, setNote] = useState('');

  const open = (r: ProblemReport) => {
    setReply(r);
    setStatus(r.status === 'open' ? 'in_progress' : r.status);
    setNote('');
  };

  return (
    <>
      <PageHead title="Problem reports">
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.length === 0 && <p className="muted">No reports{filter ? ' here' : ' yet'}.</p>}
      {data?.map((r) => (
        <div className="card" key={r.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>{REPORT_CATEGORY[r.category]}</strong>{' '}
              <Badge tone={REPORT_STATUS[r.status].tone}>{REPORT_STATUS[r.status].text}</Badge>
              <div className="muted">
                {ROLE_WORD[r.reporter_role] ?? r.reporter_role} {r.reporter_name} · {displayPhone(r.reporter_phone)} · {dateTime(r.created_at)}
              </div>
            </div>
            <button className="secondary" onClick={() => open(r)}>
              Reply / update
            </button>
          </div>
          <p style={{ marginBottom: 6 }}>{r.message}</p>
          {r.ticket_code && (
            <div className="muted">
              About ticket {r.ticket_code} · {r.plate} · {r.fare !== null ? kes(r.fare) : ''}
            </div>
          )}
          {r.office_note && (
            <div className="banner success" style={{ marginTop: 10, marginBottom: 0 }}>
              Office reply{r.handled_by_name ? ` (${r.handled_by_name})` : ''}: {r.office_note}
            </div>
          )}
        </div>
      ))}
      {reply && (
        <Dialog
          title={`Reply to ${reply.reporter_name}`}
          actionLabel="Save"
          disabled={note.trim().length > 0 && note.trim().length < 2}
          action={async () => {
            await api(`/admin/reports/${reply.id}`, { method: 'PATCH', body: { status, ...(note.trim() && { office_note: note.trim() }) } });
            setReply(null);
            await reload();
          }}
          onClose={() => setReply(null)}
        >
          <p className="muted">“{reply.message}”</p>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reply (they see it in the app; optional)
            <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. We refunded the fare to your wallet." />
          </label>
        </Dialog>
      )}
    </>
  );
}
