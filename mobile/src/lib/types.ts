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
  type: 'topup' | 'fare' | 'refund' | 'test_credit';
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
