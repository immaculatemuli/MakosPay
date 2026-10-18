/** One vehicle owner as the office sees them: details, cars with today's takings, tonight's payout, payouts. */
export interface OwnerDetail {
  owner: {
    id: number;
    name: string;
    phone: string;
    id_number: string | null;
    payout_method: 'mpesa' | 'bank';
    bank_name: string | null;
    bank_paybill: string | null;
    bank_account: string | null;
    vehicle_count: number;
  };
  vehicles: { id: number; plate: string; is_active: boolean | number; route_name: string | null; today_payments: number; today_total: number; unpaid: number }[];
  owed: number;
  refunds_to_take_back: number;
  payouts: { id: number; amount: number; trip_count: number; status: string; reference: string | null; created_at: string }[];
}
