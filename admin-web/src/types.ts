// What the FarePay API sends the office dashboard (same shapes the mobile app uses).

export type Role = 'admin' | 'passenger' | 'conductor' | 'driver' | 'platform_admin';

export interface User {
  id: number;
  name: string;
  phone: string;
  role: Role;
  is_active: number;
}

export interface Stop {
  id: number;
  name: string;
  cash_fare: number;
  app_fare: number;
}

export interface Route {
  id: number;
  name: string;
  origin: string;
  is_active: number;
  stops: Stop[];
}

export interface Vehicle {
  id: number;
  /** Short number on the sticker, typed by passengers who pay by USSD. */
  car_number: number | null;
  owner_id: number | null;
  plate: string;
  description: string | null;
  owner_name: string;
  owner_phone: string;
  owner_payout_method: 'mpesa' | 'bank';
  owner_bank_name: string | null;
  owner_bank_paybill: string | null;
  owner_bank_account: string | null;
  conductor_id: number | null;
  conductor_name: string | null;
  driver_id: number | null;
  driver_name: string | null;
  route_id: number | null;
  route_name: string | null;
  qr_token: string;
  /** Passenger seats, for seat booking. */
  seats: number;
  is_active: number;
}

export interface VehicleQr {
  plate: string;
  car_number: number | null;
  /** The SACCO's USSD code, once it has one (null: not yet). */
  ussd_code: string | null;
  file_name: string;
  png_base64: string;
  opens_with_camera: boolean;
}

export interface Payment {
  id: number;
  ticket_code: string;
  fare: number;
  cash_fare: number;
  created_at: string;
  vehicle_id: number;
  plate: string;
  route_name: string;
  stop_name: string | null;
  conductor_name: string | null;
  passenger_name: string;
  owner_name: string;
  payout_id: number | null;
  status: 'paid' | 'refunded';
  refunded_at: string | null;
  refund_reason: string | null;
}

export interface PaymentsDay {
  date: string;
  summary: { payments: number; total: number; by_vehicle: { id: number; plate: string; owner_name: string; payments: number; total: number }[] };
  payments: Payment[];
}

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
    free_rides_paid_by_sacco?: number;
    owed_to_owners: number;
    refunds_to_take_back: number;
    mpesa_pending: number;
    withdrawn_to_mpesa: number;
    withdrawals_being_sent: number;
  };
}

export interface PayoutDestination {
  method: 'mpesa' | 'bank';
  bank_name: string | null;
  bank_paybill: string | null;
  bank_account: string | null;
}

export interface OwnerOwed extends PayoutDestination {
  owner_name: string;
  owner_phone: string;
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

export interface Withdrawal {
  id: number;
  phone: string;
  amount: number;
  status: 'processing' | 'manual' | 'completed' | 'failed';
  reference: string | null;
  result_desc: string | null;
  created_at: string;
  completed_at: string | null;
  passenger_name: string;
  handled_by_name: string | null;
}

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
  cancelled_at: string | null;
  reason: string | null;
  changed_by_name: string;
  created_at: string;
}

export interface CrewMember {
  id: number;
  name: string;
  phone: string;
  is_active: number;
  created_at: string;
  vehicle_id: number | null;
  vehicle_plate: string | null;
}

export interface PassengerRow {
  id: number;
  name: string;
  phone: string;
  is_active: number;
  created_at: string;
  wallet_balance: number | null;
  trips: number;
}

export type ReportCategory = 'payment_problem' | 'wrong_fare' | 'duplicate_charge' | 'wrong_route' | 'other';

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
  reporter_phone: string;
  reporter_role: Role;
  handled_by_name: string | null;
  /** The photo on the first message, if any. */
  photo_id: number | null;
  /** Everything written after the first message, oldest first. */
  messages: ReportMessage[];
  /** Something here the reader hasn't seen yet (shown once). */
  has_new?: boolean | number;
  created_at: string;
  updated_at: string;
}

/** One reply on a problem report, from the reporter or the SACCO office (sender_name: who in the office). */
export interface ReportMessage {
  id: number;
  from_office: boolean | number;
  message: string;
  sender_name: string | null;
  photo_id: number | null;
  created_at: string;
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

/** A parcel sent through the SACCO office (its fee is SACCO income). */
export type ParcelStatus = 'awaiting_payment' | 'received' | 'on_the_way' | 'arrived' | 'collected' | 'cancelled';
export interface Parcel {
  id: number;
  tracking_code: string;
  collection_code: string;
  sender_name: string;
  sender_phone: string;
  receiver_name: string;
  receiver_phone: string;
  route_id: number;
  route_name: string;
  origin: string;
  stop_id: number;
  stop_name: string;
  description: string | null;
  fee: number;
  status: ParcelStatus;
  payment_method: 'mpesa_prompt' | 'mpesa_code' | 'cash' | null;
  payment_reference: string | null;
  paid_at: string | null;
  plate: string | null;
  created_by_name: string;
  collected_by_name: string | null;
  cancel_reason: string | null;
  created_at: string;
  loaded_at: string | null;
  arrived_at: string | null;
  collected_at: string | null;
  cancelled_at: string | null;
  payments?: { id: number; phone: string; amount: number; status: string; mpesa_receipt: string | null; result_desc: string | null; created_at: string }[];
}

/** A car's loading at the stage and its trip, as the office sees it. */
export interface TripSummary {
  id: number;
  plate: string;
  route_name: string;
  origin: string;
  state: 'loading' | 'on_the_road' | 'finished';
  seats: number;
  seats_booked: number;
  paid_bookings: number;
  booking_money: number;
  stops_reached: number;
  stops_total: number;
  started_by_name: string | null;
  started_at: string;
  departed_at: string | null;
  finished_at: string | null;
}

export interface TripDetail extends TripSummary {
  stops: { name: string; reached_at: string | null }[];
  bookings: {
    id: number;
    code: string;
    status: 'paying' | 'confirmed' | 'boarded' | 'departed' | 'cancelled' | 'paid_late';
    seats: number;
    amount: number;
    paid_with: 'wallet' | 'mpesa';
    stop_name: string;
    passenger_name: string;
    passenger_phone: string;
    booked_at: string;
    boarded_at: string | null;
  }[];
  parcels: { id: number; tracking_code: string; status: ParcelStatus; receiver_name: string; stop_name: string }[];
}
