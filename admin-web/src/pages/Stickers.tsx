import { useState } from 'react';
import type { Route } from '../types';
import { Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

interface StickerSheet {
  opens_with_camera: boolean;
  vehicles: { id: number; plate: string; route_name: string | null }[];
}

/** Every vehicle's QR sticker on one page (optionally one route's), to print all at once and cut out. */
export function Stickers() {
  const [routeId, setRouteId] = useState('');
  const routes = useApi<Route[]>('/admin/routes');
  const sheet = useApi<StickerSheet>(`/admin/vehicles/stickers${routeId ? `?route_id=${routeId}` : ''}`);
  const hint = sheet.data?.opens_with_camera ? 'Scan with your phone camera to pay by M-Pesa, or with the FarePay app.' : 'Open the FarePay app, tap Pay, and scan this code.';
  return (
    <>
      <PageHead title="Print all QR stickers" subtitle="Print, cut along the lines and stick each one in its vehicle.">
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)} aria-label="Route">
            <option value="">All routes</option>
            {routes.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button onClick={() => window.print()} disabled={!sheet.data?.vehicles.length}>
            Print {sheet.data?.vehicles.length ?? ''} stickers
          </button>
        </div>
      </PageHead>
      {sheet.error && <Failed message={sheet.error} onRetry={sheet.reload} />}
      {sheet.loading && !sheet.data && <Loading />}
      {sheet.data?.vehicles.length === 0 && <p className="muted">No vehicles in use{routeId ? ' on this route' : ''}.</p>}
      <div className="sticker-sheet">
        {sheet.data?.vehicles.map((v) => (
          <div className="sticker" key={v.id}>
            <div className="title">Pay your fare with FarePay</div>
            <img src={`/admin/vehicles/${v.id}/qr.png`} alt={`QR code for ${v.plate}`} loading="lazy" />
            <div className="plate">{v.plate}</div>
            <div className="hint">{hint}</div>
          </div>
        ))}
      </div>
    </>
  );
}
