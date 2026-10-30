// Arrival updates: after the car leaves the stage, the conductor ticks each stop as the car reaches it and finishes
// the trip; the passenger's booking shows where the car is, and the expected time at their stop from past trips.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.MPESA_CALLBACK_SECRET = 'cbsecret';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');

let server;
let base;
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const s = {};
const book = (phone) =>
  api('POST', '/book-api/bookings', { body: { route_id: s.route.id, stop_id: s.far.id, seats: 1, expected_fare: 200, phone, idempotency_key: randomUUID() } });
const booking = async (token) => (await api('GET', `/book-api/bookings/${encodeURIComponent(token)}`)).body;
const crew = async (path = '/crew/loading', method = 'GET') => (await api(method, path, { token: s.crew })).body;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos Road', origin: 'Town', stops: [{ name: 'Athi River', fare: 100 }, { name: 'Machakos', fare: 200 }] } })).body;
  [s.near, s.far] = s.route.stops;
  s.other = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Other', origin: 'Town', stops: [{ name: 'Elsewhere', fare: 50 }] } })).body;
  // These cars run the same way trip after trip: the way back made for each route is switched off (and stays off).
  await db.run("UPDATE routes SET is_active = FALSE WHERE name LIKE '% - Town'");
  const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Conductor', phone: '0711000001', password: 'Acond123' } })).body;
  await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KMA 001A', owner_name: 'Owner', owner_phone: '0744555666', seats: 5, conductor_id: c.id, route_id: s.route.id } });
  s.crew = (await api('POST', '/auth/login', { body: { phone: '0711000001', password: 'Acond123' } })).body.token;
});
after(() => server.close());

test('while the car loads: its stops, seats left, and no expected time yet', async () => {
  await crew('/crew/loading/start', 'POST');
  s.b1 = (await book('0733000001')).body;
  const b = await booking(s.b1.booking_token);
  assert.equal(b.car.status, 'loading');
  assert.equal(b.car.seats_left, 4);
  assert.deepEqual(b.car.stops, [
    { name: 'Athi River', reached_at: null, mine: false },
    { name: 'Machakos', reached_at: null, mine: true },
  ]);
  assert.equal(b.car.expected_at_my_stop, null);
});

test('the car leaves: the crew get the stops to tick, and a passenger can still be ticked in', async () => {
  const left = await crew('/crew/loading/depart', 'POST');
  assert.equal(left.loading, null);
  assert.deepEqual(left.on_road.stops.map((x) => [x.name, x.reached_at]), [['Athi River', null], ['Machakos', null]]);
  assert.equal(left.on_road.bookings[0].status, 'confirmed');
  const boarded = await api('POST', `/crew/bookings/${left.on_road.bookings[0].id}/board`, { token: s.crew });
  assert.equal(boarded.body.on_road.bookings[0].status, 'boarded');
  const b = await booking(s.b1.booking_token);
  assert.equal(b.car.status, 'departed');
  assert.ok(b.car.departed_at);
  assert.equal(b.car.expected_at_my_stop, null, 'no past trips on this route to learn from');
});

test('the conductor ticks stops; the passenger sees where the car is', async () => {
  const at = await crew(`/crew/road/stops/${s.near.id}`, 'POST');
  assert.ok(at.on_road.stops[0].reached_at);
  assert.equal((await api('POST', `/crew/road/stops/${s.near.id}`, { token: s.crew })).status, 200, 'ticking twice is fine');
  assert.equal((await api('POST', `/crew/road/stops/${s.other.stops[0].id}`, { token: s.crew })).status, 404, "another route's stop");
  let b = await booking(s.b1.booking_token);
  assert.ok(b.car.stops[0].reached_at);
  assert.equal(b.car.reached_my_stop, false);
  await crew(`/crew/road/stops/${s.far.id}`, 'POST');
  b = await booking(s.b1.booking_token);
  assert.equal(b.car.reached_my_stop, true);
  assert.equal(b.car.expected_at_my_stop, null, 'already there');
});

test('the trip is finished; nothing more can be ticked', async () => {
  const done = await crew('/crew/road/finish', 'POST');
  assert.equal(done.on_road, null);
  assert.equal((await api('POST', '/crew/road/finish', { token: s.crew })).body.error.code, 'NOT_ON_ROAD');
  assert.equal((await api('POST', `/crew/road/stops/${s.near.id}`, { token: s.crew })).body.error.code, 'NOT_ON_ROAD');
  assert.ok((await booking(s.b1.booking_token)).car.finished_at);
});

test('expected time at your stop, from how long past trips took', async () => {
  // Make the finished trip a 40-minute one to Machakos: left at 10:00, there at 10:40.
  const past = await db.get('SELECT id FROM loads ORDER BY id LIMIT 1');
  await db.run('UPDATE loads SET departed_at = ? WHERE id = ?', '2026-10-01T07:00:00.000Z', past.id);
  await db.run('UPDATE load_stops SET reached_at = ? WHERE load_id = ? AND stop_id = ?', '2026-10-01T07:40:00.000Z', past.id, s.far.id);

  await crew('/crew/loading/start', 'POST');
  const b2 = (await book('0733000002')).body;
  await crew('/crew/loading/depart', 'POST');
  const b = await booking(b2.booking_token);
  const minutes = (Date.parse(b.car.expected_at_my_stop) - Date.parse(b.car.departed_at)) / 60_000;
  assert.equal(minutes, 40);
});

test('starting to load again ends the last trip, even if nobody finished it', async () => {
  assert.ok((await crew()).on_road, 'a trip is on the road');
  const again = await crew('/crew/loading/start', 'POST');
  assert.equal(again.on_road, null);
  assert.ok(again.loading);
});
