import { Link, useNavigate } from 'react-router-dom';
import { kes } from '../format';
import type { Route } from '../types';
import { Badge, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

export function Routes() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<Route[]>('/admin/routes');
  return (
    <>
      <PageHead title="Routes & fares" subtitle="Each drop-off stop has its own cash fare and FarePay member fare.">
        <Link className="button" to="/routes/new">
          Add route
        </Link>
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.length === 0 && <p className="muted">No routes yet. Add your first route and its drop-off stops.</p>}
      {!!data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>From</th>
                <th>Drop-off stops (member fare / cash fare)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/routes/${r.id}`)}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>{r.origin}</td>
                  <td>{r.stops.map((s) => `${s.name} ${kes(s.app_fare)} / ${kes(s.cash_fare)}`).join(' · ') || '—'}</td>
                  <td>{r.is_active ? <Badge tone="success">In use</Badge> : <Badge tone="danger">Switched off</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
