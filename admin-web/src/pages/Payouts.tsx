import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { dateTime, kes, plural } from '../format';
import type { OwnerOwed, Payout } from '../types';
import { Badge, Banner, Dialog, Failed, Loading, PageHead, Stat } from '../ui';
import { useApi } from '../useApi';
import { PAYOUT_STATUS, payoutDestination, sendByHandSteps } from '../words';

type Owed = { owners: OwnerOwed[]; automatic: boolean; daily_at: string; waiting_for_drivers: { cars: number; fares: number; total: number } | null };
type Pending = { kind: 'auto' | 'manual'; owner: OwnerOwed } | { kind: 'all' };

/** What each owner is owed now, paying them (by M-Pesa, or the office sends it itself), and every payout made. */
export function Payouts() {
  const navigate = useNavigate();
  const owed = useApi<Owed>('/admin/payouts/owed');
  const history = useApi<Payout[]>('/admin/payouts');
  const [pending, setPending] = useState<Pending | null>(null);
  const o = owed.data;
  const total = o?.owners.reduce((sum, x) => sum + x.amount, 0) ?? 0;
  const reload = () => Promise.all([owed.reload(), history.reload()]);

  const act = async () => {
    if (!pending) return;
    if (pending.kind === 'all') {
      await api('/admin/payouts/run', { method: 'POST' });
      setPending(null);
      return void reload();
    }
    const payout = await api<Payout>('/admin/payouts', { method: 'POST', body: { owner_phone: pending.owner.owner_phone, manual: pending.kind === 'manual' } });
    setPending(null);
    navigate(`/payouts/${payout.id}`);
  };

  return (
    <>
      <PageHead title="Owner payouts" />
      {owed.error && <Failed message={owed.error} onRetry={owed.reload} />}
      {owed.loading && !o && <Loading />}
      {o && (
        <>
          <div className="stats">
            <Stat
              label="Owed to owners now"
              value={kes(total)}
              note={
                o.automatic
                  ? `Every day at ${o.daily_at} each owner is sent their fares by M-Pesa automatically.`
                  : `Automatic M-Pesa payouts aren't set up: at ${o.daily_at} each day, payouts are prepared for you to send yourself.`
              }
            />
            {o.waiting_for_drivers && (
              <Stat
                label="Waiting for drivers"
                value={kes(o.waiting_for_drivers.total)}
                note={`${o.waiting_for_drivers.fares} fares on ${o.waiting_for_drivers.cars} car(s). Owners are paid these once the car's driver taps "Send to owner" in the app.`}
              />
            )}
          </div>
          {!o.automatic && <Banner>Send each payout's amount from the SACCO's M-Pesa, then open the payout and enter the M-Pesa code.</Banner>}

          <h2>Owed now</h2>
          {o.owners.length === 0 && <p className="muted">Nothing owed: every fare has been paid to its owner.</p>}
          {o.owners.map((owner) => (
            <div className="card" key={owner.owner_phone} style={{ marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{owner.owner_name}</strong>
                <div className="muted">
                  {payoutDestination(owner)} · {owner.plates.join(', ')}
                </div>
                <div className="muted">
                  {plural(owner.trip_count, 'fare')}
                  {owner.deducted > 0 ? ` · ${kes(owner.fares)} minus ${kes(owner.deducted)} refunded after an earlier payout` : ''}
                </div>
              </div>
              <strong style={{ fontSize: 22 }}>{kes(owner.amount)}</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                {o.automatic && <button onClick={() => setPending({ kind: 'auto', owner })}>Pay now by M-Pesa</button>}
                <button className={o.automatic ? 'secondary' : ''} onClick={() => setPending({ kind: 'manual', owner })}>
                  I'll send it myself
                </button>
              </div>
            </div>
          ))}
          {o.automatic && o.owners.length > 1 && (
            <button className="secondary" onClick={() => setPending({ kind: 'all' })}>
              Pay everyone {kes(total)}
            </button>
          )}
        </>
      )}

      <h2>Payouts made</h2>
      {history.error && <Failed message={history.error} onRetry={history.reload} />}
      {history.data?.length === 0 && <p className="muted">No payouts yet.</p>}
      {!!history.data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Owner</th>
                <th>Paid to</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>M-Pesa code</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/payouts/${p.id}`)}>
                  <td>{dateTime(p.created_at)}</td>
                  <td>
                    {p.owner_name}
                    <div className="muted">{plural(p.trip_count, 'fare')}</div>
                  </td>
                  <td>{payoutDestination(p)}</td>
                  <td className="num">{kes(p.amount)}</td>
                  <td>
                    <Badge tone={PAYOUT_STATUS[p.status].tone}>{PAYOUT_STATUS[p.status].text}</Badge>
                  </td>
                  <td>{p.reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <Dialog
          title={pending.kind === 'all' ? `Pay everyone ${kes(total)}?` : pending.kind === 'auto' ? `Pay ${pending.owner.owner_name} ${kes(pending.owner.amount)}?` : `Send ${kes(pending.owner.amount)} yourself?`}
          actionLabel={pending.kind === 'manual' ? 'Continue' : pending.kind === 'all' ? 'Pay everyone' : 'Pay now'}
          busyLabel="Paying…"
          action={act}
          onClose={() => setPending(null)}
        >
          <p className="muted">
            {pending.kind === 'all'
              ? `Each owner gets everything they are owed now, instead of waiting for ${o?.daily_at}.`
              : pending.kind === 'auto'
                ? `The money is sent now to ${payoutDestination(pending.owner)}.`
                : `${sendByHandSteps(pending.owner, kes(pending.owner.amount))} Next, you'll enter the M-Pesa code from the confirmation SMS.`}
          </p>
        </Dialog>
      )}
    </>
  );
}
