import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { dateTime, kes, time } from '../format';
import type { Payment, Payout } from '../types';
import { Badge, Banner, Dialog, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';
import { PAYOUT_STATUS, payoutDestination, sendByHandSteps } from '../words';

/** One payout: what it covered, and recording its result by hand (the M-Pesa code, or that it failed). */
export function PayoutDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const payout = useApi<Payout & { trips: Payment[] }>(`/admin/payouts/${id}`);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<'paid' | 'failed' | 'resend' | null>(null);
  const p = payout.data;

  if (payout.loading && !p) return <Loading />;
  if (!p) return <Failed message={payout.error ?? 'Payout not found'} onRetry={payout.reload} />;
  const open = p.status === 'processing' || p.status === 'manual';

  const act = async () => {
    if (confirm === 'paid') await api(`/admin/payouts/${p.id}/complete`, { method: 'POST', body: { reference: code.trim().toUpperCase() } });
    if (confirm === 'failed') await api(`/admin/payouts/${p.id}/fail`, { method: 'POST', body: { reason: reason.trim() } });
    if (confirm === 'resend') {
      const next = await api<Payout>('/admin/payouts', { method: 'POST', body: { owner_phone: p.owner_phone, manual: true } });
      setConfirm(null);
      return navigate(`/payouts/${next.id}`);
    }
    setConfirm(null);
    setCode('');
    setReason('');
    await payout.reload();
  };

  return (
    <>
      <p>
        <Link to="/payouts">← Owner payouts</Link>
      </p>
      <PageHead title={`${kes(p.amount)} to ${p.owner_name}`} subtitle={`Payout #${p.id} · started ${dateTime(p.created_at)} · ${p.created_by ? 'by the office' : 'daily payout'}`}>
        <Badge tone={PAYOUT_STATUS[p.status].tone}>{PAYOUT_STATUS[p.status].text}</Badge>
      </PageHead>

      {p.status === 'manual' && (
        <Banner>
          1. {sendByHandSteps(p, kes(p.amount))} 2. Enter the M-Pesa code from the confirmation SMS below and click Mark as paid.
        </Banner>
      )}
      {p.status === 'processing' && <Banner>Waiting for M-Pesa to confirm. If it takes long, check the M-Pesa statement and record the result below.</Banner>}
      {p.status === 'failed' && (
        <Banner tone="danger">
          This payout failed{p.result_desc ? `: ${p.result_desc}` : ''}. Its fares are owed to the owner again and will be in the next payout.{' '}
          <button className="link" onClick={() => setConfirm('resend')}>
            Send it myself instead
          </button>
        </Banner>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="kv"><span>Paid to</span><span>{payoutDestination(p)}</span></div>
          <div className="kv"><span>Fares</span><span>{p.trip_count}</span></div>
          {p.completed_at && <div className="kv"><span>Finished</span><span>{dateTime(p.completed_at)}</span></div>}
          {p.reference && <div className="kv"><span>M-Pesa code</span><span>{p.reference}</span></div>}
          {p.result_desc && p.status !== 'failed' && <div className="kv"><span>Note</span><span>{p.result_desc}</span></div>}
        </div>
        {open && (
          <div className="card">
            <label>
              M-Pesa code
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SJK1A2B3C4" style={{ textTransform: 'uppercase' }} />
            </label>
            <button onClick={() => setConfirm('paid')} disabled={code.trim().length < 3}>
              Mark as paid
            </button>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '18px 0' }} />
            <label>
              Or, if the money did not reach the owner: reason
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button className="danger" onClick={() => setConfirm('failed')} disabled={reason.trim().length < 3}>
              Mark as failed
            </button>
          </div>
        )}
      </div>

      <h2>Fares in this payout</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Vehicle</th>
              <th>Passenger</th>
              <th>To</th>
              <th className="num">Fare</th>
            </tr>
          </thead>
          <tbody>
            {p.trips.map((t) => (
              <tr key={t.id}>
                <td>
                  {dateTime(t.created_at).split(',')[0]} {time(t.created_at)}
                </td>
                <td>{t.plate}</td>
                <td>{t.passenger_name}</td>
                <td>{t.stop_name ?? t.route_name}</td>
                <td className="num">
                  {kes(t.fare)} {t.status === 'refunded' && <Badge tone="danger">Refunded</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirm && (
        <Dialog
          title={confirm === 'paid' ? `Mark ${kes(p.amount)} as paid?` : confirm === 'failed' ? 'Mark this payout as failed?' : `Send ${kes(p.amount)} yourself?`}
          actionLabel={confirm === 'paid' ? 'Mark as paid' : confirm === 'failed' ? 'Mark as failed' : 'Continue'}
          danger={confirm === 'failed'}
          action={act}
          onClose={() => setConfirm(null)}
        >
          <p className="muted">
            {confirm === 'paid'
              ? `Only if the owner received it: M-Pesa code ${code.trim().toUpperCase()}. This can't be undone.`
              : confirm === 'failed'
                ? 'The fares become owed to the owner again and will be in their next payout.'
                : `${sendByHandSteps(p, kes(p.amount))} Then record the M-Pesa code on the new payout.`}
          </p>
        </Dialog>
      )}
    </>
  );
}
