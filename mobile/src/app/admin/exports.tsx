import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Chips, ErrorBox, List, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { authHeaders, errorMessage, getApiUrl } from '@/lib/api';
import { prettyDate } from '@/lib/format';
import { periodDates, PERIODS, type PeriodKey } from '@/lib/periods';
import { useApi } from '@/lib/useApi';

/** Reports for the accountant (Excel files): pick a period, tap a report, then save or send it from the share menu. */
export default function Exports() {
  const reports = useApi<{ kind: string; title: string }[]>('/admin/exports');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const { from, to } = periodDates(period);

  const download = async (kind: string, title: string) => {
    setBusy(kind);
    try {
      const res = await fetch(`${getApiUrl()}/admin/exports/${kind}?from=${from}&to=${to}`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Could not make the report (${res.status})`);
      const file = new File(Paths.cache, `FarePay ${title} ${from}${to !== from ? ` to ${to}` : ''}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(await res.text());
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: title, UTI: 'public.comma-separated-values-text' });
    } catch (err) {
      Alert.alert('Could not download the report', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (reports.loading && !reports.data) return <Loading />;
  return (
    <Screen>
      <Chips label="Period" options={PERIODS} value={period} onChange={setPeriod} />
      <Muted>{from === to ? prettyDate(from) : `${prettyDate(from)} – ${prettyDate(to)}`}</Muted>
      {reports.error && <ErrorBox message={reports.error} onRetry={reports.reload} />}
      {!!reports.data && (
        <List>
          {reports.data.map((r) => (
            <ListRow
              key={r.kind}
              icon={busy === r.kind ? 'hourglass-outline' : 'download-outline'}
              title={r.title}
              subtitle="Excel file (CSV): save it, or send by WhatsApp or email"
              onPress={busy ? undefined : () => void download(r.kind, r.title)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
