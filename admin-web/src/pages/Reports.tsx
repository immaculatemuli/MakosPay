import { useState } from 'react';
import { api, errorText } from '../api';
import { dateTime, displayPhone, kes } from '../format';
import type { ProblemReport } from '../types';
import { Badge, Banner, Chips, Failed, Loading, PageHead, ROLE_WORD } from '../ui';
import { useApi } from '../useApi';
import { REPORT_CATEGORY, REPORT_STATUS } from '../words';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'New' },
  { value: 'in_progress', label: 'Being looked into' },
  { value: 'resolved', label: 'Resolved' },
];
// The status buttons shown for each status.
const MOVES: Record<ProblemReport['status'], { status: ProblemReport['status']; label: string }[]> = {
  open: [
    { status: 'in_progress', label: 'Mark as being looked into' },
    { status: 'resolved', label: 'Mark as resolved' },
  ],
  in_progress: [{ status: 'resolved', label: 'Mark as resolved' }],
  resolved: [{ status: 'open', label: 'Open again' }],
};

/** Problems reported by passengers and crew: a conversation with each reporter (they write back in the app). */
export function Reports() {
  const [filter, setFilter] = useState('');
  const { data, error, loading, reload } = useApi<ProblemReport[]>(`/admin/reports${filter ? `?status=${filter}` : ''}`);

  return (
    <>
      <PageHead title="Problem reports" subtitle="Write to the reporter here; they see it in the app and can write back.">
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.length === 0 && <p className="muted">No reports{filter ? ' here' : ' yet'}.</p>}
      {data?.map((r) => <ReportCard key={r.id} report={r} onChanged={reload} />)}
    </>
  );
}

function ReportCard({ report: r, onChanged }: { report: ProblemReport; onChanged: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      await api(`/admin/reports/${r.id}/messages`, { method: 'POST', body: { message: text.trim() } });
      setText('');
    });
  const move = (status: ProblemReport['status']) => run(() => api(`/admin/reports/${r.id}`, { method: 'PATCH', body: { status } }));

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong>{REPORT_CATEGORY[r.category]}</strong> <Badge tone={REPORT_STATUS[r.status].tone}>{REPORT_STATUS[r.status].text}</Badge>
          <div className="muted">
            {ROLE_WORD[r.reporter_role] ?? r.reporter_role} {r.reporter_name} · {displayPhone(r.reporter_phone)}
          </div>
          {r.ticket_code && (
            <div className="muted">
              About ticket {r.ticket_code} · {r.plate} · {r.fare !== null ? kes(r.fare) : ''}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {MOVES[r.status].map((m) => (
            <button key={m.status} className="secondary" disabled={busy} onClick={() => move(m.status)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="thread">
        <Bubble office={false} who={r.reporter_name} at={r.created_at} text={r.message} />
        {r.messages.map((m) => (
          <Bubble key={m.id} office={Boolean(m.from_office)} who={m.from_office ? (m.sender_name ?? 'SACCO office') : r.reporter_name} at={m.created_at} text={m.message} />
        ))}
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="reply">
        <textarea rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Write to ${r.reporter_name}`} aria-label={`Write to ${r.reporter_name}`} />
        <button disabled={busy || !text.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ office, who, at, text }: { office: boolean; who: string; at: string; text: string }) {
  return (
    <div className={`bubble${office ? ' office' : ''}`}>
      <div className="who">
        {who} · {dateTime(at)}
      </div>
      <p>{text}</p>
    </div>
  );
}
