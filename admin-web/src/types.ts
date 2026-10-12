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
  is_active: number;
}

export interface VehicleQr {
  plate: string;
  file_name: string;
  png_base64: string;
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
  created_at: string;
  updated_at: string;
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
