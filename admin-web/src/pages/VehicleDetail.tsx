import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { displayPhone } from '../format';
import type { Vehicle, VehicleQr } from '../types';
import { Banner, Dialog, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

/** One vehicle and its QR sticker, ready to print (the print shows only the sticker). */
export function VehicleDetail() {
  const { id } = useParams();
  const vehicle = useApi<Vehicle>(`/admin/vehicles/${id}`);
  const qr = useApi<VehicleQr>(`/admin/vehicles/${id}/qr`);
  const [confirm, setConfirm] = useState<'qr' | 'off' | 'on' | null>(null);
  const [replaced, setReplaced] = useState(false);
  const v = vehicle.data;

  if (vehicle.loading && !v) return <Loading />;
  if (!v) return <Failed message={vehicle.error ?? 'Vehicle not found'} onRetry={vehicle.reload} />;

  return (
    <>
      <p>
        <Link to="/vehicles">← All vehicles</Link>
      </p>
      <PageHead title={v.plate} subtitle={v.description ?? undefined}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="button secondary-link" to={`/vehicles/${v.id}/edit`}>
            Edit
          </Link>
          <button className="secondary" onClick={() => setConfirm(v.is_active ? 'off' : 'on')}>
            {v.is_active ? 'Switch off' : 'Switch on'}
          </button>
          <button className="secondary" onClick={() => setConfirm('qr')}>
            Replace QR code
          </button>
          <button onClick={() => window.print()} disabled={!qr.data}>
            Print QR sticker
          </button>
        </div>
      </PageHead>
      {replaced && <Banner tone="success">New QR code made. Print the new sticker and replace the old one in the vehicle: the old one no longer works.</Banner>}
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
            Print it, cut along the line and stick it inside the vehicle where passengers can scan it. A copied or lost sticker? Replace the QR code: the old one stops working at
            once.
          </p>
        </div>
      </div>

      {confirm && (
        <Dialog
          title={confirm === 'qr' ? `Replace the QR code for ${v.plate}?` : confirm === 'off' ? `Switch ${v.plate} off?` : `Switch ${v.plate} back on?`}
          actionLabel={confirm === 'qr' ? 'Replace QR code' : confirm === 'off' ? 'Switch off' : 'Switch on'}
          danger={confirm !== 'on'}
          action={async () => {
            if (confirm === 'qr') await api(`/admin/vehicles/${v.id}/rotate-qr`, { method: 'POST' });
            else await api(`/admin/vehicles/${v.id}`, { method: 'PATCH', body: { is_active: confirm === 'on' } });
            setConfirm(null);
            setReplaced(confirm === 'qr');
            await Promise.all([vehicle.reload(), qr.reload()]);
          }}
          onClose={() => setConfirm(null)}
        >
          <p className="muted">
            {confirm === 'qr'
              ? 'The sticker in the vehicle stops working straight away. Print the new one and stick it in before passengers need it.'
              : confirm === 'off'
                ? 'Passengers will not be able to pay on it. Its conductor and driver stay on it.'
                : 'Passengers can pay on it again.'}
          </p>
        </Dialog>
      )}
    </>
  );
}
