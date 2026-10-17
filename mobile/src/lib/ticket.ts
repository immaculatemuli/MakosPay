import { router } from 'expo-router';
import { saveTickets } from './savedTickets';
import type { Trip } from './types';

export type TicketParams = {
  id: string;
  code: string;
  route: string;
  stop: string;
  plate: string;
  fare: string;
  saved: string;
  at: string;
  balance?: string;
  refunded?: string;
  reason?: string;
};

/** Opens the ticket for a trip (after paying, or from payment history); it is also saved on the phone. */
export function openTicket(trip: Trip, walletBalance?: number, replace = false) {
  void saveTickets([trip]);
  const params: TicketParams = {
    id: String(trip.id),
    code: trip.ticket_code,
    route: trip.route_name,
    stop: trip.stop_name ?? '',
    plate: trip.plate,
    fare: String(trip.fare),
    saved: String(trip.saved),
    at: trip.created_at,
    ...(walletBalance !== undefined && { balance: String(walletBalance) }),
    ...(trip.status === 'refunded' && { refunded: '1', reason: trip.refund_reason ?? '' }),
  };
  if (replace) router.replace({ pathname: '/passenger/ticket', params });
  else router.push({ pathname: '/passenger/ticket', params });
}
