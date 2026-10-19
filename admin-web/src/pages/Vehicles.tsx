import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { displayPhone } from '../format';
import type { Vehicle } from '../types';
import { Badge, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

// Filters from the Needs attention list.
const FILTER_TEXT: Record<string, string> = {
  no_route: 'Cars with no route',
  no_driver: 'Cars with no driver set',
  idle: 'Cars with no FarePay payments today',
};

export function Vehicles() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = FILTER_TEXT[params.get('filter') ?? ''] ? params.get('filter') : null;
  const { data, error, loading, reload } = useApi<Vehicle[]>(`/admin/vehicles${filter ? `?filter=${filter}` : ''}`);
  return (
    <>
      <PageHead title="Vehicles & QR stickers" subtitle="Open a vehicle to print its QR sticker, change its details or replace its QR code.">
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="button secondary-link" to="/vehicles/stickers">
            Print all stickers
          </Link>
          <Link className="button secondary-link" to="/import">
            Import from Excel
          </Link>
          <Link className="button" to="/vehicles/new">
            Add vehicle
          </Link>
        </div>
      </PageHead>
      {filter && (
        <div className="banner warning">
          {FILTER_TEXT[filter]}: {data?.length ?? 0}.{' '}
          <button className="link" onClick={() => setParams({})}>
            Show all vehicles
          </button>
        </div>
      )}
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.length === 0 && <p className="muted">{filter ? 'None.' : 'No vehicles yet. Add the first one.'}</p>}
      {!!data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Car</th>
                <th>Plate</th>
                <th>Route</th>
                <th>Owner</th>
                <th>Paid to</th>
                <th>Conductor</th>
                <th>Driver</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id} className="clickable" onClick={() => navigate(`/vehicles/${v.id}`)}>
                  <td>{v.car_number ?? '—'}</td>
                  <td>
                    <strong>{v.plate}</strong>
                  </td>
                  <td>{v.route_name ?? <Badge tone="warning">No route</Badge>}</td>
                  <td>
                    {v.owner_name}
                    <div className="muted">{displayPhone(v.owner_phone)}</div>
                  </td>
                  <td>{v.owner_payout_method === 'bank' ? `${v.owner_bank_name} (bank)` : 'M-Pesa'}</td>
                  <td>{v.conductor_name ?? '—'}</td>
                  <td>{v.driver_name ?? '—'}</td>
                  <td>{v.is_active ? <Badge tone="success">In use</Badge> : <Badge tone="danger">Not in use</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
