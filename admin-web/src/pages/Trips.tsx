import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dateTime, displayPhone, kes, nairobiToday, plural, prettyDate, time } from '../format';
import type { TripDetail, TripSummary } from '../types';
import { Badge, Failed, Loading, PageHead, Stat } from '../ui';
import { useApi } from '../useApi';
import { PARCEL_STATUS } from './Parcels';

const STATE: Record<TripSummary['state'], { label: string; tone?: 'success' | 'warning' }> = {
  loading: { label: 'Loading at the stage', tone: 'warning' },
  on_the_road: { label: 'On the road', tone: 'success' },
  finished: { label: 'Finished' },
};

const BOOKING: Record<TripDetail['bookings'][number]['status'], { label: string; tone?: 'success' | 'warning' | 'danger' }> = {
  paying: { label: 'Paying…', tone: 'warning' },
  confirmed: { label: 'Paid', tone: 'success' },
  boarded: { label: 'On board', tone: 'success' },
  departed: { label: 'Paid (car left)', tone: 'success' },
  cancelled: { label: 'Cancelled, refunded', tone: 'danger' },
  paid_late: { label: 'Paid late (to wallet)', tone: 'warning' },
};

/** Cars loading at the stage, trips on the road, and every car that loaded on a day, with their seat bookings. */
export function Trips() {
  const [date, setDate] = useState(nairobiToday());
  const { data, error, loading, reload } = useApi<{ date: string; now: { loading: number; on_the_road: number }; day: { cars: number; seats_booked: number; paid_bookings: number; booking_money: number }; trips: TripSummary[] }>(
    `/admin/trips?date=${date}`,
  );

  return (
    <>
      <PageHead title="Bookings & trips" subtitle="Cars taking seat bookings at the stage, and their trips. Booking money is fares: owners are paid it.">
        <input type="date" value={date} max={nairobiToday()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" style={{ width: 'auto' }} />
        <button className="secondary" onClick={() => void reload()}>
          Refresh
        </button>
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="stats">
            <Stat label="Loading now" value={data.now.loading} note="cars taking bookings" />
            <Stat label="On the road now" value={data.now.on_the_road} />
            <Stat label={`Seats booked, ${prettyDate(data.date)}`} value={data.day.seats_booked} note={plural(data.day.cars, 'car')} />
            <Stat label="Booking money" value={kes(data.day.booking_money)} note={plural(data.day.paid_bookings, 'paid booking')} />
          </div>
          {data.trips.length === 0 ? (
            <p className="muted">No car took bookings on {prettyDate(data.date)}. Conductors start loading from the Bookings tab in the FarePay app.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Car</th>
                    <th>Route</th>
                    <th>Where it is</th>
                    <th>Started loading</th>
                    <th>Left</th>
                    <th className="num">Seats booked</th>
                    <th className="num">Stops reached</th>
                    <th className="num">Booking money</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trips.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link to={`/trips/${t.id}`}>{t.plate}</Link>
                      </td>
                      <td>{t.route_name}</td>
                      <td>
                        <Badge tone={STATE[t.state].tone}>{STATE[t.state].label}</Badge>
                      </td>
                      <td>{dateTime(t.started_at)}</td>
                      <td>{t.departed_at ? time(t.departed_at) : '—'}</td>
                      <td className="num">
                        {t.seats_booked} / {t.seats}
                      </td>
                      <td className="num">
                        {t.stops_reached} / {t.stops_total}
                      </td>
                      <td className="num">{kes(t.booking_money)}</td>
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

/** One car's loading and trip: the stops it reached, every booking (and how it was paid), and the parcels it carried. */
export function TripPage() {
  const { id } = useParams();
  const { data: t, error, loading, reload } = useApi<TripDetail>(`/admin/trips/${id}`);
  if (loading && !t) return <Loading />;
  if (!t) return <Failed message={error ?? 'Trip not found'} onRetry={reload} />;

  return (
    <>
      <p>
        <Link to="/trips">← Bookings & trips</Link>
      </p>
      <PageHead title={`${t.plate} · ${t.route_name}`} subtitle={`Started loading ${dateTime(t.started_at)}${t.started_by_name ? ` by ${t.started_by_name}` : ''}`}>
        <button className="secondary" onClick={() => void reload()}>
          Refresh
        </button>
      </PageHead>
      <div className="stats">
        <Stat label="Where it is" value={STATE[t.state].label} note={t.departed_at ? `Left ${t.origin} ${time(t.departed_at)}` : `At ${t.origin}`} />
        <Stat label="Seats booked" value={`${t.seats_booked} / ${t.seats}`} />
        <Stat label="Booking money" value={kes(t.booking_money)} note={plural(t.paid_bookings, 'paid booking')} />
      </div>

      <h2>Stops</h2>
      <div className="card">
        {t.stops.map((s) => (
          <div className="kv" key={s.name}>
            <span>{s.name}</span>
            <span>{s.reached_at ? `Reached ${time(s.reached_at)}` : t.state === 'loading' ? 'Not left yet' : '—'}</span>
          </div>
        ))}
        {t.finished_at && (
          <div className="kv">
            <span>Trip finished</span>
            <span>{dateTime(t.finished_at)}</span>
          </div>
        )}
      </div>

      <h2>Seat bookings</h2>
      {t.bookings.length === 0 ? (
        <p className="muted">No bookings on this car.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Passenger</th>
                <th>To</th>
                <th className="num">Seats</th>
                <th className="num">Amount</th>
                <th>Paid with</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {t.bookings.map((b) => (
                <tr key={b.id}>
                  <td>{b.code}</td>
                  <td>
                    {b.passenger_name}
                    <div className="muted">{displayPhone(b.passenger_phone)}</div>
                  </td>
                  <td>{b.stop_name}</td>
                  <td className="num">{b.seats}</td>
                  <td className="num">{kes(b.amount)}</td>
                  <td>{b.paid_with === 'wallet' ? 'FarePay wallet' : 'M-Pesa'}</td>
                  <td>
                    <Badge tone={BOOKING[b.status].tone}>{BOOKING[b.status].label}</Badge>
                    {b.boarded_at && <div className="muted">boarded {time(b.boarded_at)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">To refund a booking, find its payment under Payments & refunds: the passenger gets the money in their wallet and the seat is freed.</p>

      {t.parcels.length > 0 && (
        <>
          <h2>Parcels on this car</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tracking code</th>
                  <th>To</th>
                  <th>Receiver</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {t.parcels.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/parcels/${p.id}`}>{p.tracking_code}</Link>
                    </td>
                    <td>{p.stop_name}</td>
                    <td>{p.receiver_name}</td>
                    <td>
                      <Badge tone={PARCEL_STATUS[p.status].tone}>{PARCEL_STATUS[p.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
