import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import { dateTime } from '../format';
import { Badge, Banner, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

interface TrackerStatus {
  provider: 'traccar' | 'off';
  url: string | null;
  every_seconds: number;
  checked_at: string | null;
  error: string | null;
  trackers: {
    name: string;
    identifier: string;
    status: 'online' | 'offline' | 'unknown' | null;
    vehicle: { id: number; plate: string; car_number: number } | null;
    position: { lat: number; lng: number; speed: number | null; at: string } | null;
  }[];
  cars: { id: number; plate: string; car_number: number; lat: number; lng: number; speed: number | null; recorded_at: string }[];
}

const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
const kmh = (ms: number | null) => (ms == null ? '—' : `${Math.round(ms * 3.6)} km/h`);
const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : dateTime(iso);
};

/** GPS trackers in the cars: is the tracking system connected, which tracker is on which car, where each car is. */
export function Tracker() {
  const { data, setData, error, loading, reload } = useApi<TrackerStatus>('/admin/tracker');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Follows the cars while the page is open.
  useEffect(() => {
    const timer = setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  const checkNow = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setData(await api<TrackerStatus>('/admin/tracker/check', { method: 'POST' }));
    } catch (err) {
      setCheckError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <PageHead title="Vehicle tracker" subtitle="Where each car is, from the GPS tracker fitted in it (or the crew's phone during a trip)." />
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          {data.provider === 'off' ? (
            <Banner tone="warning">
              No tracking system is connected. Set TRACKER_PROVIDER, TRACKER_URL and the tracking system's sign-in in the server settings. Until then, cars
              show a position only from the crew's phone during a trip.
            </Banner>
          ) : data.error ? (
            <Banner tone="danger">{data.error}</Banner>
          ) : (
            <Banner tone="success">
              Connected to {data.url}. Read every {data.every_seconds} seconds{data.checked_at ? `, last at ${dateTime(data.checked_at)}` : ''}.
            </Banner>
          )}
          {checkError && <Banner tone="danger">{checkError}</Banner>}
          {data.provider !== 'off' && (
            <p>
              <button onClick={checkNow} disabled={checking}>
                {checking ? 'Checking…' : 'Check now'}
              </button>
            </p>
          )}

          {data.provider !== 'off' && (
            <>
              <h2>Trackers</h2>
              <p className="muted">A tracker belongs to a car when its name or identifier in the tracking system is the car's number (e.g. 101) or its plate.</p>
              {data.trackers.length === 0 ? (
                <p className="muted">The tracking system has no trackers yet{data.checked_at ? '' : ' (or has not been read yet)'}.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Tracker</th>
                        <th>Car</th>
                        <th>Last position</th>
                        <th className="num">Speed</th>
                        <th>Map</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trackers.map((t) => (
                        <tr key={t.identifier}>
                          <td>
                            {t.name}
                            <div className="muted">
                              {t.identifier} {t.status === 'online' ? <Badge tone="success">online</Badge> : t.status ? <Badge>{t.status}</Badge> : null}
                            </div>
                          </td>
                          <td>
                            {t.vehicle ? (
                              <Link to={`/vehicles/${t.vehicle.id}`}>
                                {t.vehicle.plate} (car {t.vehicle.car_number})
                              </Link>
                            ) : (
                              <Badge tone="warning">No car matches</Badge>
                            )}
                          </td>
                          <td>{t.position ? ago(t.position.at) : <span className="muted">none yet</span>}</td>
                          <td className="num">{t.position ? kmh(t.position.speed) : '—'}</td>
                          <td>
                            {t.position && (
                              <a href={mapLink(t.position.lat, t.position.lng)} target="_blank" rel="noreferrer">
                                Open map
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <h2>Cars' latest positions</h2>
          {data.cars.length === 0 ? (
            <p className="muted">No car has a position yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Car</th>
                    <th>When</th>
                    <th className="num">Speed</th>
                    <th>Map</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cars.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/vehicles/${c.id}`}>{c.plate}</Link> <span className="muted">car {c.car_number}</span>
                      </td>
                      <td>{ago(c.recorded_at)}</td>
                      <td className="num">{kmh(c.speed)}</td>
                      <td>
                        <a href={mapLink(c.lat, c.lng)} target="_blank" rel="noreferrer">
                          Open map
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
