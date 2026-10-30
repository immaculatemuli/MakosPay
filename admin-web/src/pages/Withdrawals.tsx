import { useState } from 'react';
import { api } from '../api';
import { dateTime, displayPhone, kes } from '../format';
import type { Withdrawal } from '../types';
import { Badge, Banner, Dialog, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

type Queue = { automatic: boolean; open: Withdrawal[]; recent: Withdrawal[] };

function OpenWithdrawal({ w, onDone }: { w: Withdrawal; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<'sent' | 'not-sent' | null>(null);
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong>{w.passenger_name}</strong> <span className="muted">asked {dateTime(w.created_at)}</span>
          <div className="muted">
            {w.status === 'manual'
              ? `Send ${kes(w.amount)} to ${displayPhone(w.phone)} from the SACCO's M-Pesa, then enter the code from the confirmation SMS.`
              : 'Sent to M-Pesa, waiting for its answer. If it takes long, check the M-Pesa statement and record the result here.'}
          </div>
          {w.result_desc && <div className="muted">Note: {w.result_desc}</div>}
        </div>
        <strong style={{ fontSize: 22 }}>{kes(w.amount)}</strong>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
        <label style={{ margin: 0, flex: 1, minWidth: 180 }}>
          M-Pesa code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SJK1A2B3C4" />
        </label>
        <button onClick={() => setConfirm('sent')} disabled={code.trim().length < 3}>
          Mark as sent
        </button>
        <label style={{ margin: 0, flex: 1, minWidth: 180 }}>
          Or: why it couldn't be sent
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="danger" onClick={() => setConfirm('not-sent')} disabled={reason.trim().length < 3}>
          Not sent
        </button>
      </div>
      {confirm && (
        <Dialog
          title={confirm === 'sent' ? `Mark ${kes(w.amount)} as sent?` : 'Mark as not sent?'}
          actionLabel={confirm === 'sent' ? 'Mark as sent' : 'Return money to wallet'}
          danger={confirm === 'not-sent'}
          action={async () => {
            if (confirm === 'sent') await api(`/admin/withdrawals/${w.id}/complete`, { method: 'POST', body: { reference: code.trim() } });
            else await api(`/admin/withdrawals/${w.id}/fail`, { method: 'POST', body: { reason: reason.trim() } });
            setConfirm(null);
            onDone();
          }}
          onClose={() => setConfirm(null)}
        >
          <p className="muted">
            {confirm === 'sent'
              ? `Only if ${w.passenger_name} received it: M-Pesa code ${code.trim().toUpperCase()}. They are told it was sent.`
              : `${kes(w.amount)} goes back into ${w.passenger_name}'s FarePay wallet, and they are told why.`}
          </p>
        </Dialog>
      )}
    </div>
  );
}

/** Passengers taking wallet money back to M-Pesa: the ones waiting for the office first, then the latest. */
export function Withdrawals() {
  const { data: q, error, loading, reload } = useApi<Queue>('/admin/withdrawals');
  return (
    <>
      <PageHead title="Passenger withdrawals" subtitle="Wallet money sent back to passengers' own M-Pesa numbers." />
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !q && <Loading />}
      {q && (
        <>
          <Banner tone={q.automatic ? 'success' : 'warning'}>
            {q.automatic
              ? 'Withdrawals are sent by M-Pesa automatically. Only ones M-Pesa did not answer need you.'
              : "Automatic M-Pesa payments aren't set up, so the office sends each withdrawal itself and records the M-Pesa code."}
          </Banner>
          <h2>Waiting</h2>
          {q.open.length === 0 ? <p className="muted">Nothing waiting.</p> : q.open.map((w) => <OpenWithdrawal key={w.id} w={w} onDone={() => void reload()} />)}
          <h2>Recent</h2>
          {q.recent.length === 0 ? (
            <p className="muted">No withdrawals yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Passenger</th>
                    <th>To</th>
                    <th className="num">Amount</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {q.recent.map((w) => (
                    <tr key={w.id}>
                      <td>{dateTime(w.created_at)}</td>
                      <td>{w.passenger_name}</td>
                      <td>{displayPhone(w.phone)}</td>
                      <td className="num">{kes(w.amount)}</td>
                      <td>
                        {w.status === 'completed' ? <Badge tone="success">Sent {w.reference}</Badge> : <Badge tone="danger">Not sent, money returned</Badge>}
                        {w.status === 'failed' && w.result_desc && <div className="muted">{w.result_desc}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
