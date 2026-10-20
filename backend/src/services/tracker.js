// GPS trackers fitted in the cars: every few seconds FarePay reads the latest position of every tracker from the
// tracking company's system and keeps it as the car's position, the same one the crew's phone gives (the passengers'
// "your car is coming" map, the marshals' screen). Unlike a phone, a tracker works with no app open and no crew.
//
// Each tracker is matched to a car by its name or identifier in the tracking system: the car's number (e.g. 101) or
// its plate (spaces and case don't matter). Trackers that match no car are listed for the office to sort out.
//
// Provider: Traccar (its REST API: /api/devices and /api/positions). Many tracking companies run on Traccar; others
// (e.g. Wialon) get their own reader here with the same result.
import { config } from '../config.js';
import { db } from '../database.js';

const cfg = config.tracker;
export const trackerOn = cfg.provider !== 'off';

// The last read, for the office's tracker page.
const state = { checkedAt: null, error: null, trackers: [] };

const KNOTS_TO_MS = 0.514444; // Traccar gives speed in knots; the crew's phones (and the app) use metres per second
const clean = (text) => String(text ?? '').replace(/[\s-]/g, '').toUpperCase();

async function traccar(path) {
  const auth = cfg.token ? `Bearer ${cfg.token}` : `Basic ${Buffer.from(`${cfg.email}:${cfg.password}`).toString('base64')}`;
  const res = await fetch(`${cfg.url}${path}`, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) throw new Error('The tracking system refused the sign-in: check TRACKER_TOKEN, or TRACKER_EMAIL and TRACKER_PASSWORD');
  if (!res.ok) throw new Error(`The tracking system answered ${res.status} for ${path}`);
  return res.json();
}

/** Which car a tracker belongs to: its name or identifier is the car number or the plate. */
function matchCar(cars, device) {
  const names = [device.name, device.uniqueId].map(clean).filter(Boolean);
  return cars.find((c) => names.includes(String(c.car_number)) || names.includes(clean(c.plate))) ?? null;
}

/** Reads every tracker's latest position and saves it as its car's position. Returns how many cars were updated. */
export async function syncTrackers() {
  if (!trackerOn) return 0;
  try {
    const [devices, positions] = await Promise.all([traccar('/api/devices'), traccar('/api/positions')]);
    const cars = await db.all('SELECT id, plate, car_number FROM vehicles WHERE is_active = TRUE');
    const latest = new Map(positions.map((p) => [p.deviceId, p]));
    let updated = 0;
    const trackers = [];
    for (const device of devices) {
      const car = matchCar(cars, device);
      const p = latest.get(device.id);
      const fix = p && p.valid !== false ? { lat: p.latitude, lng: p.longitude, at: p.fixTime ?? p.deviceTime, speed: p.speed == null ? null : p.speed * KNOTS_TO_MS } : null;
      trackers.push({
        name: device.name,
        identifier: device.uniqueId,
        status: device.status ?? null, // online | offline | unknown
        vehicle: car && { id: car.id, plate: car.plate, car_number: car.car_number },
        position: fix && { lat: fix.lat, lng: fix.lng, speed: fix.speed, at: fix.at },
      });
      if (!car || !fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) continue;
      // Kept with the time the tracker took it; an older fix never replaces a newer one (e.g. from the crew's phone).
      const at = new Date(fix.at ?? Date.now()).toISOString();
      const saved = await db.run(
        `INSERT INTO vehicle_locations (vehicle_id, lat, lng, heading, speed, accuracy, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (vehicle_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, heading = excluded.heading,
           speed = excluded.speed, accuracy = excluded.accuracy, recorded_at = excluded.recorded_at
         WHERE vehicle_locations.recorded_at < excluded.recorded_at`,
        car.id,
        fix.lat,
        fix.lng,
        p.course ?? null,
        fix.speed,
        p.accuracy || null,
        at,
      );
      updated += saved.changes;
    }
    Object.assign(state, { checkedAt: new Date().toISOString(), error: null, trackers });
    return updated;
  } catch (err) {
    Object.assign(state, { checkedAt: new Date().toISOString(), error: err.name === 'TimeoutError' ? 'The tracking system did not answer in time' : err.message });
    throw err;
  }
}

/** For the office: is the tracker connection working, and which trackers belong to which cars. */
export async function trackerStatus() {
  const positions = await db.all(
    `SELECT v.id, v.plate, v.car_number, l.lat, l.lng, l.speed, l.recorded_at
     FROM vehicle_locations l JOIN vehicles v ON v.id = l.vehicle_id ORDER BY l.recorded_at DESC`,
  );
  return {
    provider: cfg.provider,
    url: trackerOn ? cfg.url : null,
    every_seconds: cfg.pollMs / 1000,
    checked_at: state.checkedAt,
    error: state.error,
    trackers: state.trackers,
    // Every car's latest known position, from a tracker or a crew phone.
    cars: positions,
  };
}
