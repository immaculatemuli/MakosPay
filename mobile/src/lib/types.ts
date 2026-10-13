export type Role = 'admin' | 'passenger' | 'conductor' | 'driver' | 'platform_admin';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'SACCO office',
  passenger: 'Passenger',
  conductor: 'Conductor',
  driver: 'Driver',
  platform_admin: 'Platform admin',
};

/** The section of the app each role uses. The platform admin uses the SACCO office screens (plus Platform). */
export const ROLE_HOME: Record<Role, '/admin' | '/passenger' | '/conductor' | '/driver'> = {
  admin: '/admin',
  platform_admin: '/admin',
  passenger: '/passenger',
  conductor: '/conductor',
  driver: '/driver',
};

/** SACCO office screens are open to the office and the platform admin. */
export const isOffice = (role: Role | undefined) => role === 'admin' || role === 'platform_admin';

/** A drop-off point on a route, with its own fares. */
export interface Stop {
  id: number;
  name: string;
  cash_fare: number;
  app_fare: number;
  you_save: number;
}

export interface Route {
  id: number;
  name: string;
  origin: string;
  is_active: number;
  stops: Stop[];
}

export interface Conductor {
  id: number;
  name: string;
  phone: string;
  is_active: number;
  vehicle_id: number | null;
  vehicle_plate: string | null;
}

export interface Vehicle extends OwnerPayoutDetails {
  id: number;
  plate: string;
  description: string | null;
  owner_name: string;
  owner_phone: string;
  conductor_id: number | null;
  conductor_name: string | null;
  driver_id: number | null;
  driver_name: string | null;
  route_id: number | null;
  route_name: string | null;
  qr_token: string;
  is_active: number;
  /** Passenger seats, for seat booking. */
  seats: number;
}

/** A seat booking on the car loading at the stage, as the crew see it. */
export interface CrewBooking {
  id: number;
  code: string;
  status: 'paying' | 'confirmed' | 'boarded';
  seats: number;
  amount: number;
  stop_name: string;
  passenger_name: string;
  passenger_phone: string;
  booked_at: string;
  boarded_at: string | null;
}

/** A parcel as the crew see it (no collection code, part-hidden receiver number). */
export interface CrewParcel {
  id: number;
  tracking_code: string;
  status: 'received' | 'on_the_way' | 'arrived';
  description: string | null;
  stop_name: string;
  receiver_name: string;
  receiver_phone: string;
  created_at: string;
  loaded_at: string | null;
  arrived_at: string | null;
}

/** Paid parcels waiting at the office for the crew's route, and the parcels on their car. */
export interface CrewParcels {
  waiting: CrewParcel[];
  on_car: CrewParcel[];
}

/** The car loading at the stage (null when not taking bookings), and its last trip still on the road (or null). */
export interface CrewLoad {
  loading: { id: number; started_at: string; seats: number; seats_booked: number; seats_left: number } | null;
  vehicle_seats: number;
  bookings: CrewBooking[];
  on_road: {
    id: number;
    departed_at: string;
    stops: { id: number; name: string; reached_at: string | null }[];
    bookings: CrewBooking[];
  } | null;
}

export type PublicRoute = Pick<Route, 'id' | 'name' | 'origin' | 'stops'>;

export interface Quote {
  vehicle: { id: number; plate: string; description: string | null; conductor_name: string | null };
  route: { id: number; name: string; origin: string; stops: Stop[] };
  /** The drop-off the fare is for: the one the passenger chose, if it is on this route. */
  stop: { id: number; name: string } | null;
  wallet_balance: number;
  /** Set when the drop-off the passenger chose is on another route. */
  chosen_elsewhere: { route_name: string; stop_name: string } | null;
  recent_payment: { ticket_code: string; created_at: string } | null;
}

export interface Trip {
  id: number;
  ticket_code: string;
  fare: number;
  cash_fare: number;
  saved: number;
  created_at: string;
  vehicle_id: number;
  plate: string;
  vehicle_description: string | null;
  route_id: number;
  route_name: string;
  origin: string;
  stop_name: string | null;
  conductor_name: string | null;
  passenger_name?: string;
  passenger_phone?: string;
  status: 'paid' | 'refunded';
  refunded_at: string | null;
  refund_reason: string | null;
}

/** How a vehicle owner is paid: M-Pesa (to their phone) or a bank account (through the bank's M-Pesa paybill). */
export interface OwnerPayoutDetails {
  owner_payout_method: 'mpesa' | 'bank';
  owner_bank_name: string | null;
  owner_bank_paybill: string | null;
  owner_bank_account: string | null;
}

export interface Staff {
  id: number;
  name: string;
  phone: string;
  is_active: number;
}

/** The conductor's vehicle and the route it is on. */
export interface ConductorVehicle {
  vehicle: { id: number; plate: string; description: string | null };
  route: { id: number; name: string; origin: string; stops: Stop[] } | null;
  today: { payments: number; total: number };
}

/** One day's payments on the conductor's vehicle. */
export interface ConductorDay {
  date: string;
  summary: { payments: number; total: number };
  payments: Trip[];
}

export interface VehicleTotal {
  id: number;
  plate: string;
  owner_name: string;
  payments: number;
  total: number;
}

export interface DaySummary {
  payments: number;
  total: number;
  by_vehicle: VehicleTotal[];
}

/** One day's payments across all vehicles (SACCO office). */
export interface AdminDay {
  date: string;
  summary: DaySummary;
  payments: (Trip & { owner_name: string; owner_phone: string; payout_id: number | null })[];
}

/** Where a payout goes. */
interface PayoutDestination {
  method: 'mpesa' | 'bank';
  bank_name: string | null;
  bank_paybill: string | null;
  bank_account: string | null;
}

export interface OwnerOwed extends PayoutDestination {
  owner_name: string;
  owner_phone: string;
  /** Fares owed, minus `deducted` (fares refunded after they were already paid out). */
  amount: number;
  fares: number;
  deducted: number;
  trip_count: number;
  plates: string[];
}

export interface Payout extends PayoutDestination {
  id: number;
  owner_name: string;
  owner_phone: string;
  amount: number;
  trip_count: number;
  status: 'processing' | 'manual' | 'completed' | 'failed';
  reference: string | null;
  result_desc: string | null;
  created_by: number | null;
  created_at: string;
  completed_at: string | null;
}

/** One fare change for a drop-off stop (applied, waiting for its date, or cancelled). */
export interface FareChange {
  id: number;
  stop_id: number;
  stop_name: string;
  route_name: string;
  old_cash_fare: number;
  old_app_fare: number;
  new_cash_fare: number;
  new_app_fare: number;
  effective_from: string;
  applied_at: string | null;
  cancelled_at?: string | null;
  reason?: string | null;
  changed_by_name?: string;
  created_at?: string;
}

export interface AuditEntry {
  id: number;
  actor_name: string | null;
  actor_role: string;
  action: string;
  entity: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface Reconciliation {
  checked_at: string;
  all_ok: boolean;
  checks: { name: string; ok: boolean; detail: string | null }[];
  totals: {
    real_money: boolean;
    mpesa_collected: number;
    test_credit: number;
    refunds_to_wallets: number;
    fares_paid: number;
    wallet_balances: number;
    paid_out_to_owners: number;
    being_paid_out: number;
    owed_to_owners: number;
    refunds_to_take_back: number;
    mpesa_pending: number;
    withdrawn_to_mpesa: number;
    withdrawals_being_sent: number;
  };
}

/** A passenger taking wallet money back to their own M-Pesa number. */
export interface Withdrawal {
  id: number;
  phone: string;
  amount: number;
  status: 'processing' | 'manual' | 'completed' | 'failed';
  reference: string | null;
  result_desc: string | null;
  created_at: string;
  completed_at: string | null;
  // Office only:
  passenger_name?: string;
  handled_by_name?: string | null;
}

/** One problem line from the M-Pesa statement check: which receipt, and the amounts on each side. */
export interface StatementLine {
  receipt: string;
  amount?: number;
  statement?: number;
  farepay?: number;
  time?: string | null;
  details?: string;
  what?: string;
}

export interface StatementCheck {
  period: { from: string | null; to: string | null };
  transactions: number;
  money_in: { matched: number; amount: number; wrong_amount: StatementLine[]; not_in_farepay: StatementLine[] };
  money_out: { matched: number; amount: number; wrong_amount: StatementLine[]; not_in_farepay: StatementLine[] };
  charges: { count: number; amount: number };
  not_in_statement: StatementLine[];
  all_ok: boolean;
}

/** A message under the bell. `target` says which screen it is about (see lib/notifications). */
export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  target: string | null;
  read_at: string | null;
  created_at: string;
}

/** The office dashboard: collections over the last 7 or 30 days (refunded fares not counted). */
export interface DashboardTotals {
  payments: number;
  collected: number;
  passengers: number;
  passengers_saved: number;
}

export interface Dashboard {
  days: 7 | 30;
  from_date: string;
  to_date: string;
  real_money: boolean;
  totals: DashboardTotals;
  previous: DashboardTotals;
  refunds: { count: number; amount: number };
  topups: { count: number; amount: number };
  by_day: { date: string; payments: number; total: number }[];
  by_route: { id: number; name: string; payments: number; total: number }[];
  by_vehicle: { id: number; plate: string; owner_name: string; payments: number; total: number }[];
  top_stops: { stop_name: string; route_name: string; payments: number; total: number }[];
  by_hour: { hour: number; payments: number }[];
}

/** A drop-off stop with its route, for "saved" and "frequent" lists. */
export interface StopChoice {
  stop_id: number;
  stop_name: string;
  cash_fare: number;
  app_fare: number;
  you_save: number;
  route_id: number;
  route_name: string;
  origin: string;
}

/** What the passenger home screen shows, worked out on the server from verified payments. */
export interface PassengerSummary {
  sacco_name: string;
  balance: number;
  this_month: { trips: number; saved: number; spent: number };
  since_joining: { trips: number; saved: number; spent: number; joined_at: string };
  frequent: StopChoice[];
  saved: StopChoice[];
}

export type ReportCategory = 'payment_problem' | 'wrong_fare' | 'duplicate_charge' | 'wrong_route' | 'other';

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  payment_problem: 'Payment problem',
  wrong_fare: 'Wrong fare',
  duplicate_charge: 'Charged twice',
  wrong_route: 'Wrong route',
  other: 'Something else',
};

export interface ProblemReport {
  id: number;
  category: ReportCategory;
  message: string;
  status: 'open' | 'in_progress' | 'resolved';
  office_note: string | null;
  trip_id: number | null;
  ticket_code: string | null;
  plate: string | null;
  fare: number | null;
  reporter_name: string;
  reporter_phone?: string;
  reporter_role?: Role;
  handled_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

/** An M-Pesa PIN prompt sent to the passenger: a wallet top-up or one fare. */
export interface MpesaPayment {
  id: number;
  phone: string;
  amount: number;
  purpose: 'wallet' | 'fare';
  status: 'initiating' | 'pending' | 'completed' | 'failed';
  mpesa_receipt: string | null;
  result_desc: string | null;
}

export interface MpesaResponse {
  payment?: MpesaPayment;
  trip?: Trip | null;
  wallet_balance: number;
}

export interface WalletTx {
  id: number;
  type: 'topup' | 'fare' | 'refund' | 'test_credit' | 'withdrawal' | 'withdrawal_reversal';
  amount: number;
  balance_after: number;
  reference: string | null;
  description: string | null;
  created_at: string;
}

export interface Paged<T> {
  items: T[];
  next_before: number | null;
}

export interface User {
  id: number;
  name: string;
  phone: string;
  role: Role;
  is_active: number;
  created_at: string;
}
