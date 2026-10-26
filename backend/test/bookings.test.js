// Seat booking on the next car loading at the stage: the conductor starts loading, passengers book and pay on the
// website, seats run out, the next car takes over, the conductor ticks passengers in and marks the car as left.
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
const book = (phone, seats, { stop = s.juja, key = randomUUID() } = {}) =>
  api('POST', '/book-api/bookings', { body: { route_id: s.route.id, stop_id: stop.id, seats, expected_fare: stop.fare ?? stop.app_fare, phone, idempotency_key: key } });
const status = (token) => api('GET', `/book-api/bookings/${encodeURIComponent(token)}`);
const loading = (crew) => api('GET', '/crew/loading', { token: crew });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Machakos Road', origin: 'Town', stops: [{ name: 'Athi River', fare: 100 }, { name: 'Machakos', fare: 200 }] },
  })).body;
  [s.athi, s.juja] = s.route.stops; // "juja" = the far stop, KES 200
  for (const [n, plate, seats] of [[1, 'KMA 001A', 3], [2, 'KMB 002B', 2]]) {
    const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: `Conductor ${n}`, phone: `071100000${n}`, password: 'Acond123' } })).body;
    const v = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate, owner_name: 'Owner', owner_phone: '0744555666', seats, conductor_id: c.id, route_id: s.route.id } })).body;
    s[`car${n}`] = v;
    s[`crew${n}`] = (await api('POST', '/auth/login', { body: { phone: `071100000${n}`, password: 'Acond123' } })).body.token;
  }
});
after(() => server.close());

test('the office sets how many seats a vehicle has', async () => {
  assert.equal(s.car1.seats, 3);
  assert.equal((await api('PATCH', `/admin/vehicles/${s.car1.id}`, { token: s.admin, body: { seats: 0 } })).status, 400);
  const defaulted = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KXX 999X', owner_name: 'Owner', owner_phone: '0744555666' } })).body;
  assert.equal(defaulted.seats, 14, 'a matatu has 14 seats unless the office says otherwise');
});

test('no car loading: nobody can book yet', async () => {
  const routes = (await api('GET', '/book-api/routes')).body;
  const r = routes.find((x) => x.id === s.route.id);
  assert.deepEqual([r.cars_loading, r.seats_left, r.next_car], [0, 0, null]);
  assert.deepEqual(r.stops.map((x) => `${x.name} ${x.fare}`), ['Athi River 100', 'Machakos 200']);
  assert.equal((await book('0733000001', 1)).body.error.code, 'NO_CAR_LOADING');
});

test('the conductor starts loading, a passenger books 2 seats and pays by M-Pesa', async () => {
  const started = await api('POST', '/crew/loading/start', { token: s.crew1 });
  assert.equal(started.status, 201);
  assert.deepEqual([started.body.loading.seats, started.body.loading.seats_left], [3, 3]);
  assert.equal((await api('POST', '/crew/loading/start', { token: s.crew1 })).body.error.code, 'ALREADY_LOADING');
  assert.equal((await api('GET', '/book-api/routes')).body.find((x) => x.id === s.route.id).next_car.plate, 'KMA 001A');

  const res = await book('0733000001', 2);
  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'confirmed'); // test M-Pesa confirms at once
  assert.deepEqual([res.body.seats, res.body.fare_each, res.body.amount, res.body.car.plate, res.body.stop_name], [2, 200, 400, 'KMA 001A', 'Machakos']);
  assert.match(res.body.code, /^[A-Z0-9]{6}$/);
  assert.equal(res.body.can_cancel, true);
  s.first = res.body;

  const crew = (await loading(s.crew1)).body;
  assert.deepEqual([crew.loading.seats_booked, crew.loading.seats_left], [2, 1]);
  assert.equal(crew.bookings[0].code, s.first.code);
  assert.equal(crew.bookings[0].passenger_phone, '0733***001', 'crew see a part-hidden number');
  const pay = (await api('GET', '/crew/payments', { token: s.crew1 })).body;
  assert.equal(pay.summary.total, 400, 'the booking is a fare on the vehicle: the owner is paid it');
});

test('seats run out: a bigger booking is refused, and the next car takes it', async () => {
  const tooMany = await book('0733000002', 2);
  assert.equal(tooMany.body.error.code, 'NOT_ENOUGH_SEATS');
  assert.equal(tooMany.body.error.details.seats_left, 1);
  await api('POST', '/crew/loading/start', { token: s.crew2 });
  const second = await book('0733000002', 2);
  assert.equal(second.body.car.plate, 'KMB 002B', 'the first car with enough seats');
  assert.equal(second.body.car.cars_ahead, 1, 'KMA 001A started loading first and leaves first');
  s.second = second.body;
  const one = await book('0733000003', 1, { stop: s.athi });
  assert.deepEqual([one.body.car.plate, one.body.amount], ['KMA 001A', 100], 'one seat still fits the first car');
  s.third = one.body;
  assert.equal((await book('0733000004', 1)).body.error.code, 'NO_CAR_LOADING', 'both cars full');
});

test('the same booking sent twice is one booking and one payment', async () => {
  await api('POST', '/crew/loading/depart', { token: s.crew2 });
  await api('POST', '/crew/loading/start', { token: s.crew2 }); // a fresh, empty load on car 2
  const key = randomUUID();
  const a = await book('0733000005', 1, { key });
  const b = await book('0733000005', 1, { key });
  assert.equal(a.body.code, b.body.code);
  const n = (await db.get("SELECT COUNT(*) AS n FROM mpesa_payments WHERE idempotency_key = ?", key)).n;
  assert.equal(n, 1);
  s.fifth = a.body;
});

test('a passenger cancels while the car is at the stage: refund to their wallet, seat freed', async () => {
  const before = (await loading(s.crew2)).body.loading.seats_left;
  const cancelled = await api('POST', `/book-api/bookings/${encodeURIComponent(s.fifth.booking_token)}/cancel`);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await loading(s.crew2)).body.loading.seats_left, before + 1);
  const passenger = await db.get("SELECT id FROM users WHERE phone = '254733000005'");
  assert.equal((await db.get('SELECT balance FROM wallets WHERE user_id = ?', passenger.id)).balance, 200);
  assert.equal((await api('POST', `/book-api/bookings/${encodeURIComponent(s.fifth.booking_token)}/cancel`)).body.error.code, 'CANNOT_CANCEL');
});

test('seats are held while the PIN prompt waits, and freed if the payment fails', async () => {
  // A booking whose PIN prompt is still waiting for the passenger (test M-Pesa answers at once, so set one up by hand).
  const crew = (await loading(s.crew2)).body;
  const before = crew.loading.seats_left;
  const passenger = await db.get("SELECT id FROM users WHERE phone = '254733000005'");
  const paymentId = await db.insert(
    "INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, vehicle_id, stop_id, idempotency_key) VALUES (?, '254733000005', 200, 'fare', 'pending', ?, ?, 'held-1')",
    passenger.id,
    s.car2.id,
    s.juja.id,
  );
  await db.insert(
    "INSERT INTO bookings (code, load_id, passenger_id, stop_id, seats, fare_each, amount, mpesa_payment_id, idempotency_key) VALUES ('HELD01', ?, ?, ?, 1, 200, 200, ?, 'held-1')",
    crew.loading.id,
    passenger.id,
    s.juja.id,
    paymentId,
  );
  const waiting = (await loading(s.crew2)).body;
  assert.equal(waiting.loading.seats_left, before - 1, 'held while paying');
  assert.equal(waiting.bookings.find((b) => b.code === 'HELD01').status, 'paying');
  await db.run("UPDATE mpesa_payments SET status = 'failed', result_desc = 'Request cancelled by user' WHERE id = ?", paymentId);
  const after = (await loading(s.crew2)).body;
  assert.equal(after.loading.seats_left, before, 'freed when it fails');
  assert.equal(after.bookings.some((b) => b.code === 'HELD01'), false, 'failed bookings are not on the list');
});

test('the conductor ticks in a passenger, then marks the car as left', async () => {
  const crew = (await loading(s.crew1)).body;
  const first = crew.bookings.find((b) => b.code === s.first.code);
  const boarded = await api('POST', `/crew/bookings/${first.id}/board`, { token: s.crew1 });
  assert.equal(boarded.body.bookings.find((b) => b.code === s.first.code).status, 'boarded');
  assert.equal((await status(s.first.booking_token)).body.status, 'boarded');
  assert.equal((await api('POST', `/book-api/bookings/${encodeURIComponent(s.first.booking_token)}/cancel`)).body.error.code, 'CANNOT_CANCEL');
  assert.equal((await api('PUT', '/crew/vehicle/route', { token: s.crew1, body: { route_id: s.route.id } })).body.error.code, 'LOADING');

  const left = await api('POST', '/crew/loading/depart', { token: s.crew1 });
  assert.equal(left.body.loading, null);
  assert.equal((await status(s.third.booking_token)).body.status, 'departed');
  assert.equal((await api('POST', '/crew/loading/depart', { token: s.crew1 })).body.error.code, 'NOT_LOADING');
});

test('booking links can not be guessed or changed, and other crew can not touch a booking', async () => {
  assert.equal((await status(`${s.second.booking_token}x`)).status, 404);
  assert.equal((await api('GET', '/passenger/wallet', { token: s.second.booking_token })).status, 401, 'a booking link is not a sign-in');
  const id = (await db.get('SELECT id FROM bookings WHERE code = ?', s.second.code)).id;
  assert.equal((await api('POST', `/crew/bookings/${id}/board`, { token: s.crew1 })).status, 404, "car 1's crew can't board car 2's passenger");
});

test('the money still adds up', async () => {
  const check = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
});
