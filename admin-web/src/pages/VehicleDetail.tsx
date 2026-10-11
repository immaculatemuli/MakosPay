import { Link, useParams } from 'react-router-dom';
import { displayPhone } from '../format';
import type { Vehicle, VehicleQr } from '../types';
import { Banner, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

/** One vehicle and its QR sticker, ready to print (the print shows only the sticker). */
export function VehicleDetail() {
  const { id } = useParams();
  const vehicle = useApi<Vehicle>(`/admin/vehicles/${id}`);
  const qr = useApi<VehicleQr>(`/admin/vehicles/${id}/qr`);
  const v = vehicle.data;

  if (vehicle.loading && !v) return <Loading />;
  if (!v) return <Failed message={vehicle.error ?? 'Vehicle not found'} onRetry={vehicle.reload} />;

  return (
    <>
      <p>
        <Link to="/vehicles">← All vehicles</Link>
      </p>
      <PageHead title={v.plate} subtitle={v.description ?? undefined}>
        <button onClick={() => window.print()} disabled={!qr.data}>
          Print QR sticker
        </button>
      </PageHead>
      {!v.is_active && <Banner tone="danger">This vehicle is switched off: passengers can't pay on it.</Banner>}
      {!v.route_name && <Banner>No route yet: passengers can't pay until it has one.</Banner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="kv"><span>Route</span><span>{v.route_name ?? 'None yet'}</span></div>
          <div className="kv"><span>Owner</span><span>{v.owner_name}</span></div>
          <div className="kv"><span>Owner's phone</span><span>{displayPhone(v.owner_phone)}</span></div>
          <div className="kv">
            <span>Owner is paid to</span>
            <span>{v.owner_payout_method === 'bank' ? `${v.owner_bank_name}, paybill ${v.owner_bank_paybill}, account ${v.owner_bank_account}` : 'M-Pesa'}</span>
          </div>
          <div className="kv"><span>Conductor</span><span>{v.conductor_name ?? 'None'}</span></div>
          <div className="kv"><span>Driver</span><span>{v.driver_name ?? 'None'}</span></div>
          <p className="muted" style={{ marginBottom: 0 }}>
            To change these details or replace the QR code, use the FarePay app (office) for now.
          </p>
        </div>

        <div>
          {qr.error && <Failed message={qr.error} onRetry={qr.reload} />}
          {qr.data && (
            <div className="sticker">
              <div className="title">Pay your fare with FarePay</div>
              <img src={`data:image/png;base64,${qr.data.png_base64}`} alt={`QR code for ${v.plate}`} />
              <div className="plate">{v.plate}</div>
              <div className="hint">Open the FarePay app, tap Pay, and scan this code.</div>
            </div>
          )}
          <p className="muted">
            Print it, cut along the line and stick it inside the vehicle where passengers can scan it. A copied or lost sticker? Replace the QR code in the app: the old one stops
            working at once.
          </p>
        </div>
      </div>
    </>
  );
}
