import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { DayBars, ShareRow } from '@/components/charts';
import { Card, Chips, colors, Empty, ErrorBox, KeyValue, Loading, Muted, Notice, Screen, SectionTitle, Stat, StatGrid } from '@/components/ui';
import { kes, prettyDate } from '@/lib/format';
import type { Dashboard } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "7am–8am" for hour 7 (Kenyan time). */
function hourRange(hour: number) {
  const label = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h % 24 < 12 ? 'am' : 'pm'}`;
  return `${label(hour)}–${label(hour + 1)}`;
}

/** Up or down compared with the period before, in plain words. */
function change(now: number, before: number, days: number) {
  if (before === 0) return now === 0 ? 'Nothing collected in either period' : `Nothing collected in the ${days} days before`;
  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) return `Same as the ${days} days before (${kes(before)})`;
  return `${percent > 0 ? 'Up' : 'Down'} ${Math.abs(percent)}% on the ${days} days before (${kes(before)})`;
}

export default function DashboardScreen() {
  const [days, setDays] = useState(7);
  const dash = useApi<Dashboard>(`/admin/dashboard?days=${days}`);
  if (dash.loading && !dash.data) return <Loading />;
  const d = dash.data;

  const maxRoute = Math.max(...(d?.by_route.map((r) => r.total) ?? []), 1);
  const maxVehicle = Math.max(...(d?.by_vehicle.map((v) => v.total) ?? []), 1);
  const idle = d?.by_vehicle.filter((v) => v.payments === 0) ?? [];
  const busiest = [...(d?.by_hour ?? [])].sort((a, b) => b.payments - a.payments || a.hour - b.hour).slice(0, 3);

  return (
    <Screen refreshing={dash.refreshing} onRefresh={dash.refresh}>
      <Chips options={PERIODS} value={days} onChange={setDays} />
      {dash.error && <ErrorBox message={dash.error} onRetry={dash.reload} />}
      {d && (
        <>
          {!d.real_money && <Notice>Test mode: these are sandbox payments, not real money.</Notice>}

          <Card>
            <Muted>
              Collected {prettyDate(d.from_date)} – {prettyDate(d.to_date)}
            </Muted>
            <Text style={{ fontSize: 30, fontWeight: '800', color: colors.text }}>{kes(d.totals.collected)}</Text>
            <Muted>{change(d.totals.collected, d.previous.collected, d.days)}</Muted>
          </Card>

          <StatGrid>
            <Stat label="Fare payments" value={String(d.totals.payments)} />
            <Stat label="Passengers who paid" value={String(d.totals.passengers)} />
            <Stat label="Average fare" value={d.totals.payments ? kes(Math.round(d.totals.collected / d.totals.payments)) : '—'} />
            <Stat label="Wallet top-ups" value={kes(d.topups.amount)} />
          </StatGrid>
          {d.refunds.count > 0 && (
            <Muted>
              {plural(d.refunds.count, 'fare')} refunded ({kes(d.refunds.amount)}), not counted above.
            </Muted>
          )}

          <SectionTitle>Each day</SectionTitle>
          <Card>
            <DayBars key={d.days} days={d.by_day} />
          </Card>

          <SectionTitle>By route</SectionTitle>
          {d.by_route.length === 0 ? (
            <Empty text="No payments in this period." />
          ) : (
            <Card>
              {d.by_route.map((r) => (
                <ShareRow key={r.id} title={r.name} subtitle={plural(r.payments, 'payment')} value={kes(r.total)} share={r.total / maxRoute} />
              ))}
            </Card>
          )}

          <SectionTitle>By vehicle</SectionTitle>
          {d.by_vehicle.length === 0 ? (
            <Empty text="No vehicles yet." />
          ) : (
            <Card>
              {d.by_vehicle.map((v) => (
                <ShareRow
                  key={v.id}
                  title={v.plate}
                  subtitle={`Owner ${v.owner_name} · ${plural(v.payments, 'payment')}`}
                  value={kes(v.total)}
                  share={v.total / maxVehicle}
                />
              ))}
            </Card>
          )}
          {idle.length > 0 && (
            <Notice>
              {idle.length === 1 ? `${idle[0].plate} had` : `${idle.length} vehicles had`} no FarePay payments in this period. Check the QR sticker is
              in place and the vehicle has the right route.
            </Notice>
          )}

          {d.top_stops.length > 0 && (
            <>
              <SectionTitle>Most popular drop-offs</SectionTitle>
              <Card>
                {d.top_stops.map((s) => (
                  <KeyValue key={`${s.route_name}-${s.stop_name}`} label={`${s.stop_name} (${s.route_name})`} value={`${plural(s.payments, 'trip')} · ${kes(s.total)}`} />
                ))}
              </Card>
            </>
          )}

          {busiest.length > 0 && (
            <>
              <SectionTitle>Busiest times</SectionTitle>
              <Card>
                {busiest.map((h) => (
                  <KeyValue key={h.hour} label={hourRange(h.hour)} value={plural(h.payments, 'payment')} />
                ))}
              </Card>
            </>
          )}

          <Muted center>Refunded fares are left out. Pull down to refresh.</Muted>
          <Text style={{ color: colors.primary, fontWeight: '600', textAlign: 'center', marginTop: 12 }} onPress={() => router.navigate('/admin/payments')}>
            See every payment
          </Text>
        </>
      )}
    </Screen>
  );
}
