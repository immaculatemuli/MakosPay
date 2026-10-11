import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Chips, colors, ErrorBox, KeyValue, Loading, Notice, Screen } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { saveChosenStop, useChosenStop } from '@/lib/chosenRoute';
import { kes, time } from '@/lib/format';
import { openTicket } from '@/lib/ticket';
import type { MpesaResponse, Quote, Trip } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { useMpesaPayment } from '@/lib/useMpesaPayment';
import { MpesaWaiting } from '@/components/MpesaWaiting';

/** After scanning: shows the vehicle, lets the passenger confirm where they get off, then pays from the wallet or by M-Pesa. */
export default function Pay() {
  const { qr } = useLocalSearchParams<{ qr?: string }>();
  const chosen = useChosenStop();
  // Wait until we know the passenger's saved drop-off, then ask for the quote once.
  const quote = useApi<Quote>(qr && chosen !== undefined ? `/passenger/scan?qr=${encodeURIComponent(qr)}${chosen ? `&stop_id=${chosen.stop_id}` : ''}` : null);
  const [stopId, setStopId] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // One id per confirmation screen: a retry after a network failure returns the same ticket instead of charging again.
  const idempotencyKey = useRef(Crypto.randomUUID());

  const mpesa = useMpesaPayment();

  useEffect(() => {
    if (quote.data && stopId === null && quote.data.stop) setStopId(quote.data.stop.id);
  }, [quote.data, stopId]);

  // M-Pesa confirmed the fare: show the ticket.
  const paidTrip = mpesa.state?.trip;
  useEffect(() => {
    if (paidTrip) openTicket(paidTrip, mpesa.state?.wallet_balance, true);
  }, [paidTrip, mpesa.state?.wallet_balance]);

  if (!qr) return <Screen><ErrorBox message="No QR code was scanned." /></Screen>;
  if (chosen === undefined || (quote.loading && !quote.data)) return <Loading />;

  if (!quote.data) {
    return (
      <Screen>
        <ErrorBox message={quote.error ?? 'Could not read this QR code.'} onRetry={quote.reload} />
        <Button title="Scan again" icon="qr-code-outline" onPress={() => router.replace('/passenger/scan')} />
      </Screen>
    );
  }

  const q = quote.data;
  const stop = q.route.stops.find((s) => s.id === stopId) ?? null;
  const canPay = stop !== null && q.wallet_balance >= stop.app_fare;

  /** Pays from the wallet, or (byMpesa) sends an M-Pesa PIN prompt for the fare. */
  const pay = async (byMpesa: boolean) => {
    if (!stop) return;
    setPaying(true);
    setPayError(null);
    try {
      const body = { qr, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: idempotencyKey.current };
      // Remember this drop-off for next time.
      await saveChosenStop({ route_id: q.route.id, route_name: q.route.name, stop_id: stop.id, stop_name: stop.name }).catch(() => {});
      if (byMpesa) {
        const res = await api<MpesaResponse>('/passenger/pay-mpesa', { method: 'POST', body });
        if (res.trip) openTicket(res.trip, res.wallet_balance, true);
        else mpesa.begin(res);
      } else {
        const res = await api<{ trip: Trip; wallet_balance: number }>('/passenger/pay', { method: 'POST', body });
        openTicket(res.trip, res.wallet_balance, true);
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'FARE_CHANGED' || err.code === 'WRONG_STOP')) {
        Alert.alert('Please check again', err.message);
        setStopId(null);
        await quote.reload();
      } else if (err instanceof ApiError && err.code === 'INSUFFICIENT_FUNDS') {
        await quote.reload();
      } else {
        setPayError(errorMessage(err));
      }
    } finally {
      setPaying(false);
    }
  };

  const mpesaPayment = mpesa.state?.payment;
  if (mpesaPayment) {
    return (
      <Screen>
        <MpesaWaiting
          payment={mpesaPayment}
          timedOut={mpesa.timedOut}
          successTitle="Paid"
          successText="Opening your ticket…"
          waitingText="Your ticket appears as soon as M-Pesa confirms. If you close this screen, it will be under Payments."
        />
        {mpesaPayment.status === 'failed' && <Button title="Try again" onPress={mpesa.reset} />}
        <Button title="Close" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 13, color: colors.muted }}>Check this is your vehicle</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text, marginTop: 2 }}>{q.vehicle.plate}</Text>
        {q.vehicle.description && <Text style={{ color: colors.muted, fontSize: 15 }}>{q.vehicle.description}</Text>}
        <View style={{ height: 8 }} />
        <KeyValue label="Route" value={q.route.name} />
        <KeyValue label="Starts from" value={q.route.origin} />
        <KeyValue label="Conductor" value={q.vehicle.conductor_name ?? 'Not listed'} />
      </Card>

      {q.chosen_elsewhere && (
        <Notice>
          You chose {q.chosen_elsewhere.stop_name} on {q.chosen_elsewhere.route_name}, but this vehicle is on {q.route.name}. Make sure you are in the
          right vehicle, then choose where you get off below.
        </Notice>
      )}

      <Chips
        label="Where are you getting off?"
        options={q.route.stops.map((s) => ({ value: s.id as number | null, label: `${s.name} · ${kes(s.app_fare)}` }))}
        value={stopId}
        onChange={setStopId}
      />

      {stop && (
        <Card>
          <View style={{ alignItems: 'center', marginVertical: 8 }}>
            <Text style={{ color: colors.muted }}>You pay to {stop.name}</Text>
            <Text style={{ fontSize: 40, fontWeight: '800', color: colors.text }}>{kes(stop.app_fare)}</Text>
            {stop.you_save > 0 && (
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                {kes(stop.you_save)} less than cash ({kes(stop.cash_fare)})
              </Text>
            )}
          </View>
          <KeyValue label="Wallet balance" value={kes(q.wallet_balance)} />
          {canPay && <KeyValue label="Balance after" value={kes(q.wallet_balance - stop.app_fare)} />}
        </Card>
      )}

      {q.recent_payment && (
        <Notice>
          You already paid on this vehicle at {time(q.recent_payment.created_at)} (ticket {q.recent_payment.ticket_code}). Only pay again if you are
          paying for someone else.
        </Notice>
      )}
      {payError && <ErrorBox message={payError} />}

      {!stop ? (
        <Button title="Choose where you get off" disabled onPress={() => {}} />
      ) : canPay ? (
        <Button title={`Pay ${kes(stop.app_fare)} from wallet`} icon="checkmark-circle-outline" onPress={() => pay(false)} loading={paying} />
      ) : (
        <>
          <Notice>Your wallet is {kes(stop.app_fare - q.wallet_balance)} short. Pay this fare with M-Pesa instead.</Notice>
          <Button title={`Pay ${kes(stop.app_fare)} with M-Pesa`} icon="phone-portrait-outline" onPress={() => pay(true)} loading={paying} />
          <Button
            title="Top up wallet instead"
            variant="secondary"
            icon="add-circle-outline"
            onPress={() => router.push({ pathname: '/passenger/topup', params: { amount: String(Math.max(stop.app_fare - q.wallet_balance, 10)) } })}
            disabled={paying}
          />
        </>
      )}
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} disabled={paying} />
    </Screen>
  );
}
