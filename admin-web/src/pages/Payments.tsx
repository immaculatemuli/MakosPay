import { useState } from 'react';
import { api, errorText } from '../api';
import { kes, nairobiToday, plural, prettyDate, time } from '../format';
import type { Payment, PaymentsDay } from '../types';
import { Badge, Banner, Failed, Loading, PageHead, Stat } from '../ui';
import { useApi } from '../useApi';

/** Refund one fare to the passenger's wallet, with a reason (shown to the passenger and kept in the audit log). */
function RefundDialog({ payment, onClose, onDone }: { payment: Payment; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/payments/${payment.id}/refund`, { method: 'POST', body: { reason: reason.trim() } });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Refund fare">
      <div className="dialog">
        <h1 style={{ fontSize: 20 }}>Refund {kes(payment.fare)}?</h1>
        <p className="muted">
          Ticket {payment.ticket_code} · {payment.passenger_name} · {payment.plate} to {payment.stop_name ?? payment.route_name}. The money goes back to the passenger's
          FarePay wallet straight away{payment.payout_id ? ', and is taken off the owner’s next payout (it was already paid out)' : ''}.
        </p>
        <label>
          Reason (the passenger sees it)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vehicle broke down" autoFocus />
        </label>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={submit} disabled={busy || reason.trim().length < 3}>
            {busy ? 'Refunding…' : 'Refund to wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every fare paid on one day (Kenyan time), with totals per vehicle, and refunds. */
export function Payments() {
  const [date, setDate] = useState(nairobiToday());
  const [vehicle, setVehicle] = useState('');
  const { data, error, loading, reload } = useApi<PaymentsDay>(`/admin/payments?date=${date}${vehicle ? `&vehicle_id=${vehicle}` : ''}`);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <>
      <PageHead title="Payments" subtitle={prettyDate(date, true)}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input type="date" value={date} max={nairobiToday()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} aria-label="Vehicle">
            <option value="">All vehicles</option>
            {data?.summary.by_vehicle.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
              </option>
            ))}
          </select>
        </div>
      </PageHead>
      {done && <Banner tone="success">{done}</Banner>}
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="stats" style={{ marginBottom: 16 }}>
            <Stat label="Collected (all vehicles)" value={kes(data.summary.total)} />
            <Stat label="Fare payments" value={data.summary.payments} />
            <Stat label="Vehicles with payments" value={data.summary.by_vehicle.length} />
          </div>
          {data.payments.length === 0 ? (
            <p className="muted">No payments{vehicle ? ' on this vehicle' : ''} on this day.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Ticket</th>
                    <th>Passenger</th>
                    <th>Vehicle</th>
                    <th>To</th>
                    <th className="num">Fare</th>
                    <th>Owner payout</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{time(p.created_at)}</td>
                      <td>{p.ticket_code}</td>
                      <td>{p.passenger_name}</td>
                      <td>{p.plate}</td>
                      <td>{p.stop_name ?? p.route_name}</td>
                      <td className="num">{kes(p.fare)}</td>
                      <td>{p.status === 'refunded' ? '—' : p.payout_id ? <Badge tone="success">Paid out</Badge> : <Badge>Waiting</Badge>}</td>
                      <td>
                        {p.status === 'refunded' ? (
                          <Badge tone="danger">Refunded{p.refund_reason ? `: ${p.refund_reason}` : ''}</Badge>
                        ) : (
                          <button className="secondary" onClick={() => setRefunding(p)}>
                            Refund
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">{plural(data.payments.length, 'payment')} shown. Refunded fares are not counted in the totals.</p>
        </>
      )}
      {refunding && (
        <RefundDialog
          payment={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setDone(`${kes(refunding.fare)} refunded to ${refunding.passenger_name}'s wallet (ticket ${refunding.ticket_code}).`);
            setRefunding(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
