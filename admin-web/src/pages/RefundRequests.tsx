import { useState } from 'react';
import { api } from '../api';
import { dateTime, displayPhone, kes } from '../format';
import type { RefundRequest } from '../types';
import { Badge, Dialog, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

function Waiting({ r, onDone }: { r: RefundRequest; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<'refund' | 'decline' | null>(null);
  const where = r.free_ride
    ? 'A free ride: refunding gives the passenger their free ride back.'
    : r.no_app
      ? `Paid without the app: ${kes(r.fare)} goes back to ${displayPhone(r.passenger_phone)} by M-Pesa.`
      : `${kes(r.fare)} goes back to the passenger's FarePay wallet.`;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong>{r.reason}</strong>
          <div className="muted">
            Asked by {r.requested_by_name} ({r.requested_by_role}) {dateTime(r.created_at)}
          </div>
          <div className="muted">
            {r.plate} · {r.route_name} · ticket {r.ticket_code}
            {r.stop_name ? ` to ${r.stop_name}` : ''} · paid {dateTime(r.paid_at)}
          </div>
          <div className="muted">
            {r.passenger_name} · {displayPhone(r.passenger_phone)}
          </div>
          <div className="muted">{where}</div>
        </div>
        <strong style={{ fontSize: 22 }}>{kes(r.fare)}</strong>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
        <button onClick={() => setConfirm('refund')}>Refund the passenger</button>
        <label style={{ margin: 0, flex: 1, minWidth: 180 }}>
          Or say no: why (the crew see this)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
        <button className="danger" onClick={() => setConfirm('decline')} disabled={note.trim().length < 3}>
          Don't refund
        </button>
      </div>
      {confirm && (
        <Dialog
          title={confirm === 'refund' ? `Refund ${kes(r.fare)}?` : "Don't refund?"}
          actionLabel={confirm === 'refund' ? 'Refund' : "Don't refund"}
          danger={confirm === 'decline'}
          action={async () => {
            if (confirm === 'refund') await api(`/admin/refund-requests/${r.id}/approve`, { method: 'POST' });
            else await api(`/admin/refund-requests/${r.id}/decline`, { method: 'POST', body: { note: note.trim() } });
            setConfirm(null);
            onDone();
          }}
          onClose={() => setConfirm(null)}
        >
          <p className="muted">
            {confirm === 'refund'
              ? `${where} If the owner was already paid for it, it comes off their next payout. ${r.requested_by_name} is told.`
              : `${r.passenger_name} keeps the ticket. ${r.requested_by_name} sees: "${note.trim()}"`}
          </p>
        </Dialog>
      )}
    </div>
  );
}

/** "Paid by mistake" requests from conductors and drivers: waiting ones first, then the latest decided. */
export function RefundRequests() {
  const waiting = useApi<{ requests: RefundRequest[] }>('/admin/refund-requests');
  const all = useApi<{ requests: RefundRequest[] }>('/admin/refund-requests?status=all');
  const reload = () => {
    void waiting.reload();
    void all.reload();
  };
  const decided = (all.data?.requests ?? []).filter((r) => r.status !== 'waiting');
  return (
    <>
      <PageHead title="Refunds asked by crew" subtitle="Conductors and drivers say a passenger paid by mistake. Only the office refunds." />
      {waiting.error && <Failed message={waiting.error} onRetry={reload} />}
      {waiting.loading && !waiting.data && <Loading />}
      <h2>Waiting</h2>
      {waiting.data?.requests.length === 0 ? <p className="muted">Nothing waiting.</p> : waiting.data?.requests.map((r) => <Waiting key={r.id} r={r} onDone={reload} />)}
      <h2>Decided</h2>
      {decided.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asked</th>
                <th>Car</th>
                <th>Reason</th>
                <th className="num">Fare</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((r) => (
                <tr key={r.id}>
                  <td>
                    {dateTime(r.created_at)}
                    <div className="muted">{r.requested_by_name}</div>
                  </td>
                  <td>
                    {r.plate}
                    <div className="muted">ticket {r.ticket_code}</div>
                  </td>
                  <td>{r.reason}</td>
                  <td className="num">{kes(r.fare)}</td>
                  <td>
                    {r.status === 'refunded' ? <Badge tone="success">Refunded</Badge> : <Badge>Refused</Badge>}
                    <div className="muted">
                      {r.decided_by_name ?? 'Office'}
                      {r.decided_at ? `, ${dateTime(r.decided_at)}` : ''}
                    </div>
                    {r.office_note && <div className="muted">{r.office_note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
