import type { OfficeParcel } from './types';

/** Where a parcel is, in the office's words. */
export const PARCEL_WORD: Record<OfficeParcel['status'], string> = {
  awaiting_payment: 'Waiting for payment',
  received: 'At the office',
  on_the_way: 'On the way',
  arrived: 'Arrived',
  collected: 'Collected',
  cancelled: 'Cancelled',
};
