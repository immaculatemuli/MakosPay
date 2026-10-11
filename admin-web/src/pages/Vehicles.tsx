import { useNavigate } from 'react-router-dom';
import { displayPhone } from '../format';
import type { Vehicle } from '../types';
import { Badge, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

export function Vehicles() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<Vehicle[]>('/admin/vehicles');
  return (
    <>
      <PageHead title="Vehicles & QR stickers" subtitle="Open a vehicle to print its QR sticker." />
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.length === 0 && <p className="muted">No vehicles yet. Add them in the FarePay app (office) for now.</p>}
      {!!data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
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
