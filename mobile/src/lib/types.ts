export type Role = 'admin' | 'passenger' | 'conductor' | 'driver' | 'platform_admin' | 'marshal';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'SACCO office',
  passenger: 'Passenger',
  conductor: 'Conductor',
  driver: 'Driver',
  platform_admin: 'Platform admin',
  marshal: 'Stage marshal',
};

/** The section of the app each role uses. The platform admin uses the SACCO office screens (plus Platform). */
export const ROLE_HOME: Record<Role, '/admin' | '/passenger' | '/conductor' | '/driver' | '/marshal'> = {
  admin: '/admin',
  platform_admin: '/admin',
  passenger: '/passenger',
  conductor: '/conductor',
  driver: '/driver',
  marshal: '/marshal',
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
  /** The route's one fare: the same wherever the passenger gets off. */
  fare?: number | null;
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
  /** Short number on the sticker, typed by passengers who pay by USSD. */
  car_number: number | null;
  owner_id: number | null;
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
  /** seats_booked: seats taken (bookings and FarePay fares paid on the car while loading); full: marked full by hand. */
  loading: { id: number; started_at: string; seats: number; seats_booked: number; seats_left: number; full: boolean } | null;
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
  /** This ride is the passenger's free one (loyalty). */
  free_ride: boolean;
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
  /** A loyalty free ride: paid by the SACCO, nothing taken from the passenger. */
  free_ride?: boolean | number;
  /** The passenger's own rating of this trip (1–5), in their trip list. */
  my_rating?: number | null;
}

/** Loyalty: paid rides counted towards the next free one. */
export interface FreeRideProgress {
  every: number;
  rides: number;
  needed: number;
  next_is_free: boolean;
  window_days: number;
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
/** The car's latest trip today: from loading at the stage until it finished (or until now), and what was paid. */
export interface CrewTrip {
  id: number;
  route_name: string;
  started_at: string;
  departed_at: string | null;
  finished_at: string | null;
  payments: number;
  total: number;
}

/** The cash the crew said they collected on the car that day (only declared, never checked). */
export interface CashDeclared {
  day: string;
  amount: number;
  updated_at: string;
  declared_by_name: string;
}

export interface ConductorDay {
  date: string;
  summary: { payments: number; total: number };
  cash: CashDeclared | null;
  /** Today only (null on other days, or before the car's first trip today). */
  trip: CrewTrip | null;
  payments: CrewPayment[];
}

/** A payment on the crew's car, with the latest "paid by mistake" request about it (null: none). */
export interface CrewPayment extends Trip {
  refund_request: { status: 'waiting' | 'refunded' | 'declined'; office_note: string | null } | null;
}

/** A "paid by mistake" request from a conductor or driver, for the office. */
export interface RefundRequest {
  id: number;
  trip_id: number;
  reason: string;
  status: 'waiting' | 'refunded' | 'declined';
  office_note: string | null;
  created_at: string;
  decided_at: string | null;
  requested_by_name: string;
  requested_by_role: 'conductor' | 'driver';
  decided_by_name: string | null;
  ticket_code: string;
  fare: number;
  free_ride: boolean;
  stop_name: string | null;
  paid_at: string;
  trip_status: 'paid' | 'refunded';
  passenger_name: string;
  passenger_phone: string;
  no_app: boolean;
  plate: string;
  route_name: string;
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
    free_rides_paid_by_sacco?: number;
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
  free_ride: FreeRideProgress;
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
  /** The photo on the first message, if any. */
  photo_id?: number | null;
  /** Everything written after the first message, oldest first. */
  messages: ReportMessage[];
  /** Something here the reader hasn't seen yet (shown once). */
  has_new?: boolean | number;
  created_at: string;
  updated_at: string;
}

/** One reply on a problem report, from the reporter or the SACCO office. */
export interface ReportMessage {
  id: number;
  from_office: boolean | number;
  message: string;
  /** Who in the office wrote it (only the office sees this). */
  sender_name?: string | null;
  photo_id?: number | null;
  created_at: string;
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
  type: 'topup' | 'fare' | 'refund' | 'test_credit' | 'withdrawal' | 'withdrawal_reversal' | 'booking_hold' | 'booking_release' | 'free_ride' | 'free_ride_reversal';
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

/** A route as shown for seat booking: its stops and fares, and the car loading now (if any). */
export interface BookingRoute {
  id: number;
  name: string;
  origin: string;
  stops: { id: number; name: string; fare: number }[];
  cars_loading: number;
  seats_left: number;
  next_car: { plate: string; seats_left: number } | null;
}

/** A seat booking, as the passenger sees it. */
export interface Booking {
  id: number;
  status: 'paying' | 'confirmed' | 'boarded' | 'departed' | 'cancelled' | 'failed' | 'paid_late';
  code: string;
  seats: number;
  fare_each: number;
  amount: number;
  reason: string | null;
  booked_at: string;
  route: { name: string; origin: string };
  stop_name: string;
  car: {
    plate: string;
    description: string | null;
    status: 'loading' | 'departed';
    loading_since: string;
    departed_at: string | null;
    finished_at: string | null;
    cars_ahead: number;
    seats_left: number | null;
    stops: { name: string; reached_at: string | null; mine: boolean }[];
    reached_my_stop: boolean;
    expected_at_my_stop: string | null;
  };
  can_cancel: boolean;
  wallet_balance?: number;
}

/** Routes for booking a seat from anywhere: stops in order with fares, and seats already queued at the stage. */
export interface SeatRoutes {
  open: boolean;
  opens_at: string;
  closes_at: string;
  /** Booking for later: a "ready from" time today or tomorrow (YYYY-MM-DD), from opens_at to last_ready_at. */
  later: { today: string; tomorrow: string; last_ready_at: string };
  routes: {
    id: number;
    name: string;
    origin: string;
    stops: { id: number; name: string; fare: number; position: number }[];
    seats_waiting: number;
    cars_loading: number;
  }[];
}

/** A seat booking as the stage marshal (or a car's crew) sees it. */
export interface QueueBooking {
  id: number;
  code: string;
  status: 'queued' | 'assigned' | 'boarded';
  seats: number;
  amount: number;
  stop_name: string;
  pickup_name: string | null;
  passenger_name: string;
  passenger_phone: string;
  passenger_here: boolean;
  booked_at: string;
  /** Booked for later: when they will be ready. */
  ready_at: string | null;
  /** Place in the stage queue (1 = next), or null. */
  place: number | null;
  at_stage?: boolean;
}

/** A car loading at the stage or on the road, with the seat bookings on it. */
export interface QueueCar {
  load_id: number;
  vehicle_id: number;
  plate: string;
  description: string | null;
  state: 'loading' | 'on_the_road';
  seats: number;
  seats_left: number;
  /** Marked full by the marshal or crew (e.g. cash passengers filled it): takes nobody from the queue. */
  full: boolean;
  started_at: string;
  departed_at: string | null;
  stops_reached: number[];
  driver: CrewContact | null;
  conductor: CrewContact | null;
  location: CarLocation | null;
  bookings: QueueBooking[];
}

/** One route's queue, as the marshal sees it. */
export interface RouteQueue {
  id: number;
  name: string;
  origin: string;
  stops: { id: number; name: string }[];
  stage_queue: QueueBooking[];
  seats_waiting: number;
  road_pickups: QueueBooking[];
  /** Booked for later (today or tomorrow): they join the queue at their "ready from" time. */
  later: QueueBooking[];
  cars: QueueCar[];
}

export interface MarshalQueues {
  today: string;
  open: boolean;
  routes: RouteQueue[];
}

/** A vehicle the marshal can say has arrived. */
export interface MarshalVehicle {
  id: number;
  plate: string;
  description: string | null;
  seats: number;
  route_id: number | null;
  route_name: string | null;
  busy: 'loading' | 'departed' | null;
}

/** A car's latest position from its crew's phone. */
export interface CarLocation {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  at: string;
}

/** A person on a car's crew, to call. */
export interface CrewContact {
  name: string;
  phone: string;
}

/** A seat booked from anywhere: waiting in the stage queue (or on the road), then put on a car. */
export interface SeatBooking {
  id: number;
  code: string;
  status: 'paying' | 'queued' | 'assigned' | 'boarded' | 'cancelled' | 'failed';
  route: { id: number; name: string; origin: string };
  pickup: { stop_id: number | null; name: string; at_stage: boolean };
  stop_name: string;
  seats: number;
  fare_each: number;
  amount: number;
  pay_with: 'mpesa' | 'wallet';
  booked_at: string;
  /** Booked for later: when they will be ready (they join the queue then). later: that time hasn't come yet. */
  ready_at: string | null;
  later: boolean;
  /** How many are ahead in the stage queue (0 = next); null when not waiting at the stage. */
  place_in_queue: number | null;
  passenger_here_at: string | null;
  car: {
    plate: string;
    description: string | null;
    status: 'loading' | 'departed' | 'finished';
    departed_at: string | null;
    driver: CrewContact | null;
    conductor: CrewContact | null;
    /** Where the car is (while the passenger waits for it), from its crew's phone. */
    location: CarLocation | null;
    /** A road pickup's car on the way: when it usually reaches the pickup. */
    expected_at_pickup: string | null;
    /** On board: the stops after the pickup up to the drop-off, ticked as the crew reach them. */
    stops?: { name: string; reached_at: string | null; mine: boolean }[];
    reached_my_stop?: boolean;
    /** On board: when the car usually reaches the drop-off (null once there, or with no past trips). */
    expected_at_my_stop?: string | null;
  } | null;
  assigned_at: string | null;
  boarded_at: string | null;
  /** On board: the fare paid for this booking, and the passenger's rating of it. */
  trip_id: number | null;
  my_rating: number | null;
  reason: string | null;
  refund_to: 'mpesa' | 'wallet' | null;
  can_cancel: boolean;
  /** The passenger's free ride (loyalty): nothing was charged. */
  free_ride: boolean;
  wallet_balance?: number;
}

/** Where a parcel is (public: no phone numbers, fee or collection code). */
export interface ParcelTracking {
  tracking_code: string;
  status: 'awaiting_payment' | 'received' | 'on_the_way' | 'arrived' | 'collected' | 'cancelled';
  from: string;
  to: string;
  route: string;
  receiver: string;
  sender: string;
  plate: string | null;
  expected_at: string | null;
  events: { what: string; at: string }[];
}

/** A car's loading at the stage and its trip, as the office sees it. */
export interface OfficeTrip {
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

export interface OfficeTripDetail extends OfficeTrip {
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
  parcels: { id: number; tracking_code: string; status: OfficeParcel['status']; receiver_name: string; stop_name: string }[];
}

/** A parcel as the office sees it (with the collection code, to give the sender). */
export interface OfficeParcel {
  id: number;
  tracking_code: string;
  collection_code: string;
  sender_name: string;
  sender_phone: string;
  receiver_name: string;
  receiver_phone: string;
  route_name: string;
  origin: string;
  stop_name: string;
  description: string | null;
  fee: number;
  status: 'awaiting_payment' | 'received' | 'on_the_way' | 'arrived' | 'collected' | 'cancelled';
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

/** Passengers' trip ratings, for the office: the newest, and averages (lowest first) per car, driver and conductor. */
export interface OfficeRatings {
  ratings: {
    id: number;
    stars: number;
    comment: string | null;
    created_at: string;
    ticket_code: string;
    stop_name: string | null;
    route_name: string;
    vehicle_id: number;
    plate: string;
    driver_name: string | null;
    conductor_name: string | null;
    passenger_name: string;
  }[];
  by_vehicle: RatingAverage[];
  by_driver: RatingAverage[];
  by_conductor: RatingAverage[];
}

export interface RatingAverage {
  id: number;
  name: string;
  average: number;
  count: number;
}
