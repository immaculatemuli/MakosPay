import { useState } from 'react';
import { api, errorText } from '../api';
import { dateTime, kes } from '../format';
import type { StatementCheck, StatementLine } from '../types';
import { Banner, PageHead } from '../ui';

function Problems({ title, help, lines, describe }: { title: string; help: string; lines: StatementLine[]; describe: (l: StatementLine) => string }) {
  if (lines.length === 0) return null;
  return (
    <>
      <h2>
        {title} ({lines.length})
      </h2>
      <p className="muted">{help}</p>
      <div className="table-wrap">
        <table>
          <tbody>
            {lines.map((l) => (
              <tr key={`${title}-${l.receipt}`}>
                <td>
                  <strong>{l.receipt}</strong>
                </td>
                <td>{describe(l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Match the M-Pesa statement (CSV from the M-Pesa business portal) against FarePay, receipt by receipt. Changes nothing. */
export function Statement() {
  const [file, setFile] = useState<string | null>(null);
  const [result, setResult] = useState<StatementCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setFile(picked.name);
    setResult(null);
    setError(null);
    if (picked.size > 5_000_000) return setError('That file is too big (more than 5 MB). Download a shorter period.');
    setBusy(true);
    try {
      setResult(await api<StatementCheck>('/admin/statement-check', { method: 'POST', body: { csv: await picked.text() } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const r = result;
  const problems = r ? r.money_in.wrong_amount.length + r.money_in.not_in_farepay.length + r.money_out.wrong_amount.length + r.money_out.not_in_farepay.length + r.not_in_statement.length : 0;

  return (
    <>
      <PageHead title="M-Pesa statement check" subtitle="Download the statement from the M-Pesa business portal as a CSV file, then choose it here. Nothing is changed." />
      <div className="card">
        <label style={{ marginBottom: 0 }}>
          M-Pesa statement (CSV)
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void choose(e.target.files?.[0])} disabled={busy} />
        </label>
        {busy && <p className="muted">Checking {file}…</p>}
      </div>
      {error && (
        <div style={{ marginTop: 12 }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {r && (
        <>
          <div style={{ marginTop: 16 }}>
            <Banner tone={r.all_ok ? 'success' : 'warning'}>
              {r.all_ok ? 'Everything matches: every receipt is in FarePay with the same amount.' : `${problems} thing${problems === 1 ? '' : 's'} to look at (listed below).`}
            </Banner>
          </div>
          <div className="card">
            <div className="kv"><span>File</span><span>{file}</span></div>
            <div className="kv"><span>Period</span><span>{r.period.from && r.period.to ? `${dateTime(r.period.from)} – ${dateTime(r.period.to)}` : '—'}</span></div>
            <div className="kv"><span>Transactions read</span><span>{r.transactions}</span></div>
            <div className="kv"><span>Money in matched</span><span>{r.money_in.matched} · {kes(r.money_in.amount)}</span></div>
            <div className="kv"><span>Money out matched</span><span>{r.money_out.matched} · {kes(r.money_out.amount)}</span></div>
            <div className="kv"><span>M-Pesa charges</span><span>{r.charges.count} · {kes(r.charges.amount)}</span></div>
          </div>
          <Problems
            title="Amount differs"
            help="In both, but the amounts are different."
            lines={[...r.money_in.wrong_amount, ...r.money_out.wrong_amount]}
            describe={(l) => `Statement ${kes(l.statement ?? 0)}, FarePay ${kes(l.farepay ?? 0)}${l.what ? ` · ${l.what}` : ''}`}
          />
          <Problems
            title="Money in, not in FarePay"
            help="Received on the Paybill but not recorded as a FarePay payment (e.g. someone paid the Paybill directly)."
            lines={r.money_in.not_in_farepay}
            describe={(l) => `${kes(l.amount ?? 0)}${l.time ? ` · ${dateTime(l.time)}` : ''}${l.details ? ` · ${l.details}` : ''}`}
          />
          <Problems
            title="Money out, not in FarePay"
            help="Sent from the Paybill but not recorded as an owner payout or a passenger withdrawal."
            lines={r.money_out.not_in_farepay}
            describe={(l) => `${kes(l.amount ?? 0)}${l.time ? ` · ${dateTime(l.time)}` : ''}${l.details ? ` · ${l.details}` : ''}`}
          />
          <Problems
            title="In FarePay, not in the statement"
            help="FarePay recorded these M-Pesa payments in this period, but the statement doesn't have them."
            lines={r.not_in_statement}
            describe={(l) => `${kes(l.amount ?? 0)} · ${l.what ?? ''}`}
          />
          <p className="muted">The result is saved in the audit log.</p>
        </>
      )}
    </>
  );
}
