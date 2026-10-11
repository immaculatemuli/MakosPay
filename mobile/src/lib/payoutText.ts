import { displayPhone } from './format';

type Destination = { method: 'mpesa' | 'bank'; bank_name: string | null; bank_paybill: string | null; bank_account: string | null; owner_phone: string };

/** "M-Pesa 0744 555 666" or "Equity Bank · acc 0123456789". */
export const payoutDestination = (d: Destination) =>
  d.method === 'bank' ? `${d.bank_name ?? 'Bank'} · acc ${d.bank_account ?? ''}` : `M-Pesa ${displayPhone(d.owner_phone)}`;

/** Instructions for the office to send a payout by hand. */
export const sendByHandSteps = (d: Destination, amount: string) =>
  d.method === 'bank'
    ? `Pay ${amount} by M-Pesa to paybill ${d.bank_paybill}, account number ${d.bank_account} (${d.bank_name}).`
    : `Send ${amount} by M-Pesa to ${displayPhone(d.owner_phone)}.`;
