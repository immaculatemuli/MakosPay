import { dateTime, kes } from '../format';
import type { Reconciliation } from '../types';
import { Banner, Failed, Loading, PageHead, TestMoneyBanner } from '../ui';
import { useApi } from '../useApi';

/** Do wallets, M-Pesa, fares and owner payouts all add up? (The same check runs every night at 23:00.) */
export function MoneyCheck() {
  const { data: d, error, loading, reload } = useApi<Reconciliation>('/admin/reconciliation');
  return (
    <>
      <PageHead title="Money check" subtitle={d && `Checked ${dateTime(d.checked_at)}`}>
        <button className="secondary" onClick={() => void reload()} disabled={loading}>
          {loading ? 'Checking…' : 'Check again'}
        </button>
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !d && <Loading />}
      {d && (
        <>
          <TestMoneyBanner realMoney={d.totals.real_money} />
          <Banner tone={d.all_ok ? 'success' : 'danger'}>
            {d.all_ok
              ? `Everything adds up: all ${d.checks.length} checks passed.`
              : `${d.checks.filter((c) => !c.ok).length} check(s) found a problem. See below, and the audit log in the app, to find what is out.`}
          </Banner>
          <div className="card">
            {d.checks.map((c) => (
              <div className="check" key={c.name}>
                <span className={`dot ${c.ok ? 'ok' : 'bad'}`} aria-label={c.ok ? 'OK' : 'Problem'}>
                  {c.ok ? '✓' : '!'}
                </span>
                <div>
                  <div>{c.name}</div>
                  {c.detail && <div className="muted">{c.detail}</div>}
                </div>
              </div>
            ))}
          </div>

          <h2>Totals</h2>
          <div className="card">
            <div className="kv"><span>Received by M-Pesa</span><span>{kes(d.totals.mpesa_collected)}</span></div>
            {d.totals.test_credit > 0 && <div className="kv"><span>Test credit (not real money)</span><span>{kes(d.totals.test_credit)}</span></div>}
            <div className="kv"><span>In passengers' wallets now</span><span>{kes(d.totals.wallet_balances)}</span></div>
            <div className="kv"><span>Fares paid</span><span>{kes(d.totals.fares_paid)}</span></div>
            <div className="kv"><span>Refunded to wallets</span><span>{kes(d.totals.refunds_to_wallets)}</span></div>
            <div className="kv"><span>Paid out to owners</span><span>{kes(d.totals.paid_out_to_owners)}</span></div>
            <div className="kv"><span>Being paid out</span><span>{kes(d.totals.being_paid_out)}</span></div>
            <div className="kv"><span>Still owed to owners</span><span>{kes(d.totals.owed_to_owners)}</span></div>
            {d.totals.refunds_to_take_back > 0 && <div className="kv"><span>Refunds to take off next payouts</span><span>{kes(d.totals.refunds_to_take_back)}</span></div>}
            {d.totals.mpesa_pending > 0 && <div className="kv"><span>M-Pesa waiting for confirmation</span><span>{kes(d.totals.mpesa_pending)}</span></div>}
            <div className="kv"><span>Withdrawn by passengers to M-Pesa</span><span>{kes(d.totals.withdrawn_to_mpesa)}</span></div>
            {d.totals.withdrawals_being_sent > 0 && <div className="kv"><span>Withdrawals being sent</span><span>{kes(d.totals.withdrawals_being_sent)}</span></div>}
          </div>
        </>
      )}
    </>
  );
}
