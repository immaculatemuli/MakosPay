import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, colors, ErrorBox, KeyValue, List, ListRow, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, kes } from '@/lib/format';
import type { StatementCheck, StatementLine } from '@/lib/types';

function Problems({ title, help, lines, describe }: { title: string; help: string; lines: StatementLine[]; describe: (l: StatementLine) => string }) {
  if (lines.length === 0) return null;
  return (
    <>
      <SectionTitle>{`${title} (${lines.length})`}</SectionTitle>
      <Muted>{help}</Muted>
      <List>
        {lines.map((l) => (
          <ListRow key={`${title}-${l.receipt}`} icon="alert-circle-outline" title={l.receipt} subtitle={describe(l)} />
        ))}
      </List>
    </>
  );
}

/**
 * Compare the M-Pesa statement with FarePay: every receipt in the statement should be in FarePay with the
 * same amount, and every M-Pesa payment FarePay recorded should be in the statement.
 */
export default function StatementCheckScreen() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<StatementCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setFileName(asset.name);
    setResult(null);
    setBusy(true);
    try {
      const csv = await new File(asset.uri).text();
      setResult(await api<StatementCheck>('/admin/statement-check', { method: 'POST', body: { csv } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const r = result;
  const problems = r
    ? r.money_in.wrong_amount.length + r.money_in.not_in_farepay.length + r.money_out.wrong_amount.length + r.money_out.not_in_farepay.length + r.not_in_statement.length
    : 0;

  return (
    <Screen>
      <Muted>
        Download the statement from the M-Pesa business portal (org.ke.m-pesa.com) as a CSV file, for example for yesterday, then choose
        it here. FarePay checks it receipt by receipt. Nothing is changed.
      </Muted>
      <Button title={fileName ? 'Choose another statement' : 'Choose M-Pesa statement (CSV)'} icon="document-text-outline" onPress={pick} loading={busy} />
      {fileName && <Muted>File: {fileName}</Muted>}
      {error && <ErrorBox message={error} />}

      {r && (
        <>
          <Notice tone={r.all_ok ? 'success' : 'warning'}>
            {r.all_ok ? 'Everything matches: every receipt is in FarePay with the same amount.' : `${problems} thing${problems === 1 ? '' : 's'} to look at (listed below).`}
          </Notice>
          <Card>
            <KeyValue label="Period" value={r.period.from && r.period.to ? `${dateTime(r.period.from)} – ${dateTime(r.period.to)}` : '—'} />
            <KeyValue label="Transactions read" value={String(r.transactions)} />
            <KeyValue label="Money in matched" value={`${r.money_in.matched} · ${kes(r.money_in.amount)}`} />
            <KeyValue label="Money out matched" value={`${r.money_out.matched} · ${kes(r.money_out.amount)}`} />
            <KeyValue label="M-Pesa charges" value={`${r.charges.count} · ${kes(r.charges.amount)}`} />
          </Card>

          <Problems
            title="Amount differs"
            help="In both, but the amounts are different."
            lines={[...r.money_in.wrong_amount, ...r.money_out.wrong_amount]}
            describe={(l) => `Statement ${kes(l.statement ?? 0)}, FarePay ${kes(l.farepay ?? 0)}${l.what ? ` · ${l.what}` : ''}`}
          />
          <Problems
            title="Money in, not in FarePay"
            help="Received on the Paybill but not recorded as a FarePay payment, e.g. someone paid the Paybill directly."
            lines={r.money_in.not_in_farepay}
            describe={(l) => `${kes(l.amount ?? 0)}${l.time ? ` · ${dateTime(l.time)}` : ''}${l.details ? ` · ${l.details}` : ''}`}
          />
          <Problems
            title="Money out, not in FarePay"
            help="Sent from the Paybill but not recorded as an owner payout or withdrawal."
            lines={r.money_out.not_in_farepay}
            describe={(l) => `${kes(l.amount ?? 0)}${l.time ? ` · ${dateTime(l.time)}` : ''}${l.details ? ` · ${l.details}` : ''}`}
          />
          <Problems
            title="In FarePay, not in the statement"
            help="FarePay recorded these M-Pesa payments in this period, but the statement doesn't have them."
            lines={r.not_in_statement}
            describe={(l) => `${kes(l.amount ?? 0)} · ${l.what ?? ''}`}
          />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>The result is saved in the audit log.</Text>
        </>
      )}
    </Screen>
  );
}
