import type { Href } from 'expo-router';

/**
 * Where an item of the office's "Needs attention" list or a search result opens in the app. The server sends a
 * short link ("payouts", "vehicles:no_route", "vehicle:12"...) that the app and the web dashboard each map to a screen.
 */
export function officeHref(link: string | null): Href | null {
  if (!link) return null;
  const [kind, value] = link.split(/:(.*)/s);
  switch (kind) {
    case 'money-check':
      return '/admin/reconciliation';
    case 'payouts':
      return '/admin/payouts';
    case 'withdrawals':
      return '/admin/withdrawals';
    case 'reports':
      return '/admin/reports';
    case 'queues':
      return '/marshal';
    case 'parcels':
      return '/admin/parcels';
    case 'parcel':
      return `/admin/parcel/${value}`;
    case 'vehicles':
      return value ? { pathname: '/admin/vehicles', params: { filter: value } } : '/admin/vehicles';
    case 'vehicle':
      return `/admin/vehicle/${value}`;
    case 'passenger':
      return { pathname: '/admin/passengers', params: { q: value } };
    case 'crew':
      return { pathname: '/admin/crew', params: { role: value } };
    case 'staff':
      return '/admin/staff';
    case 'payments':
      return '/admin/payments';
    default:
      return null;
  }
}
