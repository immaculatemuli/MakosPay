// Plain words for what the API sends as codes (the same wording as the FarePay app).
import { displayPhone } from './format';
import type { PayoutDestination, ReportCategory } from './types';

/** "M-Pesa 0744555666" or "Equity Bank · acc 0123456789". */
export const payoutDestination = (d: PayoutDestination & { owner_phone: string }) =>
  d.method === 'bank' ? `${d.bank_name ?? 'Bank'} · acc ${d.bank_account ?? ''}` : `M-Pesa ${displayPhone(d.owner_phone)}`;

/** Instructions for the office to send a payout by hand. */
export const sendByHandSteps = (d: PayoutDestination & { owner_phone: string }, amount: string) =>
  d.method === 'bank'
    ? `Pay ${amount} by M-Pesa to paybill ${d.bank_paybill}, account number ${d.bank_account} (${d.bank_name}).`
    : `Send ${amount} by M-Pesa to ${displayPhone(d.owner_phone)}.`;

export const PAYOUT_STATUS: Record<string, { text: string; tone?: 'success' | 'danger' | 'warning' }> = {
  processing: { text: 'Sending by M-Pesa', tone: 'warning' },
  manual: { text: 'Waiting for you to send', tone: 'warning' },
  completed: { text: 'Paid', tone: 'success' },
  failed: { text: 'Failed', tone: 'danger' },
};

export const REPORT_CATEGORY: Record<ReportCategory, string> = {
  payment_problem: 'Payment problem',
  wrong_fare: 'Wrong fare',
  duplicate_charge: 'Charged twice',
  wrong_route: 'Wrong route',
  other: 'Something else',
};

export const REPORT_STATUS: Record<string, { text: string; tone?: 'success' | 'danger' | 'warning' }> = {
  open: { text: 'New', tone: 'danger' },
  in_progress: { text: 'Being looked into', tone: 'warning' },
  resolved: { text: 'Resolved', tone: 'success' },
};

const AUDIT: [RegExp, string][] = [
  [/^POST \/admin\/routes$/, 'Added a route'],
  [/^PATCH \/admin\/routes\/:id$/, 'Changed a route or its fares'],
  [/^POST \/admin\/stops\/:id\/fare-change$/, 'Set a new fare'],
  [/^POST \/admin\/fare-changes\/:id\/cancel$/, 'Cancelled a fare change'],
  [/^POST \/admin\/vehicles$/, 'Added a vehicle'],
  [/^PATCH \/admin\/vehicles\/:id$/, 'Changed a vehicle'],
  [/^POST \/admin\/vehicles\/:id\/rotate-qr$/, 'Replaced a QR sticker'],
  [/^POST \/admin\/conductors$/, 'Added a conductor'],
  [/^PATCH \/admin\/conductors\/:id$/, 'Changed a conductor account'],
  [/^POST \/admin\/drivers$/, 'Added a driver'],
  [/^PATCH \/admin\/drivers\/:id$/, 'Changed a driver account'],
  [/^POST \/admin\/conductors\/:id\/delete$/, 'Deleted a conductor'],
  [/^POST \/admin\/drivers\/:id\/delete$/, 'Deleted a driver'],
  [/^POST \/admin\/marshals$/, 'Added a stage marshal'],
  [/^POST \/admin\/owners$/, 'Added a vehicle owner'],
  [/^PATCH \/admin\/owners\/:id$/, 'Changed a vehicle owner’s details'],
  [/^POST \/admin\/broadcast$/, 'Sent a message to crew'],
  [/^import\.routes$/, 'Imported routes from Excel'],
  [/^import\.crew$/, 'Imported crew from Excel'],
  [/^import\.vehicles$/, 'Imported vehicles from Excel'],
  [/^PATCH \/admin\/marshals\/:id$/, 'Changed a stage marshal account'],
  [/^POST \/admin\/marshals\/:id\/delete$/, 'Deleted a stage marshal'],
  [/^POST \/marshal\/cars\/arrived$/, 'Said a car arrived at the stage'],
  [/^POST \/marshal\/cars\/:vehicleId\/left$/, 'Said a car left the stage'],
  [/^POST \/marshal\/seats\/:id\/assign$/, 'Gave a road pickup to a car'],
  [/^POST \/marshal\/seats\/:id\/board$/, 'Ticked a booked passenger on board'],
  [/^POST \/marshal\/seats\/:id\/cancel$/, 'Cancelled a seat booking'],
  [/^POST \/admin\/staff$/, 'Added an office account'],
  [/^PATCH \/admin\/staff\/:id$/, 'Changed an office account'],
  [/^POST \/admin\/users\/:id\/password$/, 'Set a new password for someone'],
  [/^POST \/admin\/payments\/:id\/refund$/, 'Refunded a fare'],
  [/^PATCH \/admin\/reports\/:id$/, 'Replied to a problem report'],
  [/^POST \/admin\/payouts$/, 'Paid an owner'],
  [/^POST \/admin\/payouts\/run$/, 'Paid all owners'],
  [/^POST \/admin\/payouts\/:id\/complete$/, 'Marked a payout as paid'],
  [/^POST \/admin\/payouts\/:id\/fail$/, 'Marked a payout as failed'],
  [/^POST \/admin\/withdrawals\/:id\/complete$/, 'Marked a withdrawal as sent'],
  [/^POST \/admin\/withdrawals\/:id\/fail$/, 'Marked a withdrawal as not sent'],
  [/^POST \/admin\/statement-check$|^statement\.check$/, 'Checked an M-Pesa statement'],
  [/^POST \/platform\/admins$/, 'Added a platform admin'],
  [/^PATCH \/platform\/admins\/:id$/, 'Changed a platform admin'],
  [/^PUT \/(crew|conductor)\/vehicle\/route$/, 'Changed the vehicle’s route'],
  [/^POST \/crew\/loading\/start$/, 'Started taking seat bookings at the stage'],
  [/^POST \/crew\/loading\/depart$/, 'Marked the car as left the stage'],
  [/^POST \/crew\/bookings\/:id\/board$/, 'Ticked in a booked passenger'],
  [/^POST \/crew\/road\/stops\/:id$/, 'Marked a stop as reached'],
  [/^POST \/crew\/road\/finish$/, 'Finished a trip'],
  [/^POST \/admin\/parcels$/, 'Recorded a parcel'],
  [/^POST \/admin\/parcels\/:id\/prompt$/, 'Sent a parcel fee PIN prompt'],
  [/^POST \/admin\/parcels\/:id\/payment$/, 'Recorded a parcel fee payment'],
  [/^POST \/admin\/parcels\/:id\/cancel$/, 'Cancelled a parcel'],
  [/^POST \/(admin|crew)\/parcels\/:id\/collect$/, 'Handed a parcel to its receiver'],
  [/^POST \/crew\/parcels\/:id\/load$/, 'Loaded a parcel onto the car'],
  [/^POST \/crew\/parcels\/:id\/arrive$/, 'Marked a parcel as arrived'],
  [/^payout\.confirmed$/, 'M-Pesa confirmed a payout'],
  [/^payout\.failed$/, 'M-Pesa rejected a payout'],
  [/^payout\.daily_run$/, 'Daily owner payouts ran'],
  [/^withdrawal\.confirmed$/, 'M-Pesa confirmed a withdrawal'],
  [/^withdrawal\.failed$/, 'M-Pesa rejected a withdrawal'],
  [/^money_check\.nightly$/, 'Nightly money check ran'],
  [/^account\.delete$/, 'A passenger deleted their account'],
  [/^account\.rename$/, 'A passenger changed their name'],
  [/^account\.password_changed$/, 'Changed their own password'],
  [/^account\.password_reset_by_sms$/, 'Set a new password with an SMS code'],
];

export const auditLabel = (action: string) => AUDIT.find(([re]) => re.test(action))?.[1] ?? action;
