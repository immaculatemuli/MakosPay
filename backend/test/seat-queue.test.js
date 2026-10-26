// Seat booking from anywhere: paid seats join the stage queue (or wait to be picked on the road), cars that reach the
// stage are filled first booked first served, and the money is exact and always accounted for.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
// Booking is open all day in these tests (closed only for the last minute before midnight).
process.env.SEAT_BOOKING_CUTOFF = '23:59';
process.env.SEAT_BOOKING_OPENS = '00:00';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { handleStkCallback } = await import('../src/services/payments.js');
const { refundUnboarded } = await import('../src/services/seats.js');
const { config } = await import('../src/config.js');

let server;
let base;
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const login = async (phone, password) => (await api('POST', '/auth/login', { body: { phone, password } })).body.token;
const s = {};

// Three passengers, each with KES 2000 test money in the wallet.
async function passenger(name, phone) {
  const token = (await signUp(api, { name, phone, password: 'Apass123' })).body.token;
  const userId = (await db.get('SELECT id FROM users WHERE phone = ?', `254${phone.slice(1)}`)).id;
  await tx(() => postWalletEntry(userId, { type: 'test_credit', amount: 2000 }));
  return { token, userId };
}
const book = (who, body) =>
  api('POST', '/passenger/seats', {
    token: who.token,
    body: { route_id: s.route.id, stop_id: s.machakos.id, seats: 1, expected_fare: 400, idempotency_key: randomUUID(), pay_with: 'wallet', ...body },
  });
const balance = async (who) => (await db.get('SELECT balance FROM wallets WHERE user_id = ?', who.userId)).balance;
const queues = async () => (await api('GET', '/marshal/queues', { token: s.marshal })).body.routes.find((r) => r.id === s.route.id);
const seat = async (who, id) => (await api('GET', `/passenger/seats/${id}`, { token: who.token })).body;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: {
      name: 'Nairobi - Machakos',
      origin: 'Town',
      stops: [
        { name: 'Juja', cash_fare: 150, app_fare: 150 },
        { name: 'Kyumbi', cash_fare: 300, app_fare: 300 },
        { name: 'Machakos', cash_fare: 400, app_fare: 400 },
      ],
    },
  })).body;
  [s.juja, s.kyumbi, s.machakos] = s.route.stops;
  const driver = (await api('POST', '/admin/drivers', { token: s.admin, body: { name: 'Dan Driver', phone: '0711000001', password: 'Adrive123' } })).body;
  const vehicle = (plate, seats, driverId) =>
    api('POST', '/admin/vehicles', { token: s.admin, body: { plate, owner_name: `Owner ${plate}`, owner_phone: '0744555666', route_id: s.route.id, seats, ...(driverId && { driver_id: driverId }) } });
  s.carA = (await vehicle('KDA 111A', 3, driver.id)).body;
  s.carB = (await vehicle('KDB 222B', 14)).body;
  s.driver = await login('0711000001', 'Adrive123');
  const marshal = await api('POST', '/admin/marshals', { token: s.admin, body: { name: 'Mary Marshal', phone: '0722000009', password: 'Amarsh123' } });
  assert.equal(marshal.status, 201, JSON.stringify(marshal.body));
  s.marshal = await login('0722000009', 'Amarsh123');
  s.p1 = await passenger('Pat One', '0733000001');
  s.p2 = await passenger('Pam Two', '0733000002');
  s.p3 = await passenger('Pete Three', '0733000003');
});
after(() => server.close());

test('the price is the fare table × seats, checked against what the passenger was shown', async () => {
  const changed = await book(s.p1, { expected_fare: 350 });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, 'FARE_CHANGED');
  const backwards = await book(s.p1, { pickup_stop_id: s.machakos.id, stop_id: s.juja.id, expected_fare: 150 });
  assert.equal(backwards.body.error.code, 'PICKUP_AFTER_DROPOFF');
  assert.equal(await balance(s.p1), 2000, 'nothing taken');
});

test('a paid booking joins the stage queue in order, its money held', async () => {
  const first = await book(s.p1, { seats: 2 });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.amount, 800);
  assert.equal(first.body.status, 'queued');
  assert.equal(first.body.place_in_queue, 0);
  assert.equal(await balance(s.p1), 1200, '800 held');
  s.b1 = first.body.id;

  const second = await book(s.p2, { seats: 2 });
  assert.equal(second.body.place_in_queue, 1);
  s.b2 = second.body.id;
  const third = await book(s.p3, { seats: 1, stop_id: s.kyumbi.id, expected_fare: 300 });
  assert.equal(third.body.amount, 300);
  s.b3 = third.body.id;

  const q = await queues();
  assert.deepEqual(q.stage_queue.map((b) => b.id), [s.b1, s.b2, s.b3]);
  assert.equal(q.seats_waiting, 5);
});

test('M-Pesa: the PIN prompt asks for exactly fare × seats, and the paid booking joins the queue', async () => {
  const r = await book(s.p1, { pay_with: 'mpesa', seats: 3, stop_id: s.juja.id, expected_fare: 150 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const payment = await db.get('SELECT * FROM mpesa_payments WHERE id = (SELECT mpesa_payment_id FROM seat_bookings WHERE id = ?)', r.body.id);
  assert.equal(payment.amount, 450);
  assert.equal(payment.purpose, 'seat');
  assert.equal(payment.status, 'completed');
  assert.equal(r.body.status, 'queued');
  assert.equal(await balance(s.p1), 1200, 'M-Pesa money went in and straight into the hold');
  s.bMpesa = r.body.id;
});

test('a car that reaches the stage takes the queue first booked, first served; a booking too big waits its turn', async () => {
  // KDA 111A has 3 seats: Pat (2) fits, Pam (2) does not, Pete (1) does.
  const r = await api('POST', '/marshal/cars/arrived', { token: s.marshal, body: { vehicle_id: s.carA.id } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await seat(s.p1, s.b1)).status, 'assigned');
  assert.equal((await seat(s.p1, s.b1)).car.plate, 'KDA 111A');
  assert.equal((await seat(s.p2, s.b2)).status, 'queued');
  assert.equal((await seat(s.p2, s.b2)).place_in_queue, 0, 'Pam is now first for the next car');
  assert.equal((await seat(s.p3, s.b3)).status, 'assigned');
  const notes = (await api('GET', '/notifications', { token: s.p1.token })).body.items;
  assert.ok(notes.some((n) => n.title === 'Board KDA 111A now'));
  const car = (await queues()).cars.find((c) => c.plate === 'KDA 111A');
  assert.equal(car.seats_left, 0);
});

test('boarding releases the held money and pays it as a fare on that car, for its owner', async () => {
  const r = await api('POST', `/marshal/seats/${s.b1}/board`, { token: s.marshal });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = await seat(s.p1, s.b1);
  assert.equal(b.status, 'boarded');
  const trip = await db.get('SELECT * FROM trips WHERE id = ?', b.trip_id);
  assert.equal(trip.fare, 800);
  assert.equal(trip.vehicle_id, s.carA.id);
  assert.equal(trip.owner_name, 'Owner KDA 111A');
  assert.equal(await balance(s.p1), 1200, 'released then paid: no change for the passenger');
});

test('a car leaving without someone sends them back to the front of the queue', async () => {
  await api('POST', `/marshal/cars/${s.carA.id}/left`, { token: s.marshal });
  const pete = await seat(s.p3, s.b3);
  assert.equal(pete.status, 'queued');
  assert.equal(pete.place_in_queue, 1, 'Pete keeps his original place: behind Pam, who booked first');
  assert.equal((await seat(s.p2, s.b2)).place_in_queue, 0);
});

test('a road pickup is given to a car, its driver is told, and the driver ticks them on', async () => {
  // A booking to be picked at Juja (going to Machakos): full fare from the stage.
  const r = await book(s.p2, { pickup_stop_id: s.juja.id, expected_fare: 400 });
  assert.equal(r.body.amount, 400);
  assert.equal(r.body.pickup.name, 'Juja');
  s.road = r.body.id;
  const q = await queues();
  assert.ok(q.road_pickups.some((b) => b.id === s.road));
  assert.ok(!q.stage_queue.some((b) => b.id === s.road), 'not in the stage queue');

  // KDA 111A is on the road with 1 free seat (Pete didn't board).
  const car = q.cars.find((c) => c.plate === 'KDA 111A');
  assert.equal(car.state, 'on_the_road');
  const assigned = await api('POST', `/marshal/seats/${s.road}/assign`, { token: s.marshal, body: { load_id: car.load_id } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const driverNotes = (await api('GET', '/notifications', { token: s.driver })).body.items;
  assert.ok(driverNotes.some((n) => n.title === 'Pick 1 seat at Juja'));
  const forDriver = (await api('GET', '/crew/seats', { token: s.driver })).body;
  assert.ok(forDriver.some((b) => b.id === s.road && b.pickup_name === 'Juja'));
  const passengerSees = await seat(s.p2, s.road);
  assert.equal(passengerSees.car.plate, 'KDA 111A');
  assert.equal(passengerSees.car.driver.phone, '254711000001', 'the passenger can call the driver');

  assert.equal((await api('POST', `/passenger/seats/${s.road}/here`, { token: s.p2.token })).status, 200);
  assert.equal((await api('POST', `/crew/seats/${s.road}/board`, { token: s.driver })).status, 200);
  assert.equal((await seat(s.p2, s.road)).status, 'boarded');
});

test('a car can only take what fits, and not after it passed the pickup point', async () => {
  const big = await book(s.p3, { pickup_stop_id: s.juja.id, seats: 2, expected_fare: 400 });
  const car = (await queues()).cars.find((c) => c.plate === 'KDA 111A');
  const full = await api('POST', `/marshal/seats/${big.body.id}/assign`, { token: s.marshal, body: { load_id: car.load_id } });
  assert.equal(full.body.error.code, 'NOT_ENOUGH_SEATS');
  s.bigRoad = big.body.id;
});

test('cancelling refunds exactly: M-Pesa bookings to M-Pesa, wallet bookings to the wallet', async () => {
  const before = await balance(s.p1);
  const r = await api('POST', `/passenger/seats/${s.bMpesa}/cancel`, { token: s.p1.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'cancelled');
  assert.equal(r.body.refund_to, 'mpesa');
  const w = await db.get('SELECT * FROM withdrawals WHERE id = (SELECT refund_withdrawal_id FROM seat_bookings WHERE id = ?)', s.bMpesa);
  assert.equal(w.amount, 450);
  assert.equal(w.status, 'completed', 'sent back by M-Pesa (test mode)');
  assert.equal(await balance(s.p1), before, 'released and sent out: the wallet is unchanged');

  const p3Before = await balance(s.p3);
  const c = await api('POST', `/marshal/seats/${s.bigRoad}/cancel`, { token: s.marshal, body: { reason: 'Passenger asked' } });
  assert.equal(c.body.routes ? 200 : c.status, 200);
  assert.equal(await balance(s.p3), p3Before + 800, 'wallet booking back in the wallet');
  assert.equal((await api('POST', `/passenger/seats/${s.bMpesa}/cancel`, { token: s.p1.token })).status, 409, 'only once');
});

test('if M-Pesa says a different amount was paid, nobody is seated and the money goes to the wallet', async () => {
  const userId = s.p1.userId;
  const paymentId = await db.insert(
    "INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, checkout_request_id, idempotency_key) VALUES (?, '254733000001', 400, 'seat', 'pending', 'ws_wrong_amount', 'seat-x')",
    userId,
  );
  const bookingId = await db.insert(
    "INSERT INTO seat_bookings (code, passenger_id, route_id, stop_id, seats, fare_each, amount, pay_with, mpesa_payment_id, status, idempotency_key) VALUES ('WRONG1', ?, ?, ?, 1, 400, 400, 'mpesa', ?, 'paying', 'k-wrong')",
    userId,
    s.route.id,
    s.machakos.id,
    paymentId,
  );
  const before = await balance(s.p1);
  await handleStkCallback({
    Body: { stkCallback: { CheckoutRequestID: 'ws_wrong_amount', ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 1 }, { Name: 'MpesaReceiptNumber', Value: 'WRONGAMT1' }] } } },
  });
  assert.equal((await db.get('SELECT status FROM seat_bookings WHERE id = ?', bookingId)).status, 'failed');
  assert.equal(await balance(s.p1), before + 1, 'what was really paid is in the wallet');
});

test('only marshals and the office use the marshal screens', async () => {
  assert.equal((await api('GET', '/marshal/queues', { token: s.p1.token })).status, 403);
  assert.equal((await api('GET', '/marshal/queues', { token: s.driver })).status, 403);
  assert.equal((await api('GET', '/marshal/queues', { token: s.admin })).status, 200);
  const found = (await api('GET', '/marshal/vehicles?q=kdb', { token: s.marshal })).body;
  assert.deepEqual(found.map((v) => v.plate), ['KDB 222B']);
});

test('no booking at the cutoff; anything not on a car by then is refunded', async () => {
  const { seatBookingCutoff, seatBookingOpens } = config;
  // Closed from midnight until 23:59: closed now (unless the test runs in the last minute of the day).
  config.seatBookingCutoff = '00:00';
  config.seatBookingOpens = '23:59';
  try {
    const closed = await book(s.p1, {});
    assert.equal(closed.body.error.code, 'BOOKING_CLOSED');
  } finally {
    Object.assign(config, { seatBookingCutoff, seatBookingOpens });
  }
  const waiting = (await db.all("SELECT id FROM seat_bookings WHERE status = 'queued'")).length;
  assert.ok(waiting > 0);
  await refundUnboarded();
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM seat_bookings WHERE status = 'queued'")).n, 0);
});

test('a pickup the car never made goes back to the queue when its trip ends', async () => {
  const { finishTrip } = await import('../src/services/bookings.js');
  await api('POST', '/marshal/cars/arrived', { token: s.marshal, body: { vehicle_id: s.carB.id } });
  await api('POST', `/marshal/cars/${s.carB.id}/left`, { token: s.marshal });
  const r = await book(s.p3, { pickup_stop_id: s.kyumbi.id, stop_id: s.machakos.id, expected_fare: 400 });
  const car = (await queues()).cars.find((c) => c.plate === 'KDB 222B');
  const assigned = await api('POST', `/marshal/seats/${r.body.id}/assign`, { token: s.marshal, body: { load_id: car.load_id } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal((await seat(s.p3, r.body.id)).status, 'assigned');
  await finishTrip(s.carB);
  const back = await seat(s.p3, r.body.id);
  assert.equal(back.status, 'queued', 'still paid, waiting for the next car');
  assert.equal(back.car, null);
  await api('POST', `/passenger/seats/${r.body.id}/cancel`, { token: s.p3.token });
});

test('the website books without signing in: M-Pesa to the number given, kept by its link', async () => {
  const r = await api('POST', '/book-api/seats', {
    body: { route_id: s.route.id, pickup_stop_id: s.juja.id, stop_id: s.machakos.id, seats: 1, expected_fare: 400, phone: '0755123456', idempotency_key: randomUUID() },
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.status, 'queued', 'paid (test M-Pesa)');
  assert.ok(r.body.token);
  const seen = (await api('GET', `/book-api/seats/${r.body.token}`)).body;
  assert.equal(seen.pickup.name, 'Juja');
  assert.equal((await api('POST', `/book-api/seats/${r.body.token}/here`)).status, 200);
  const cancelled = (await api('POST', `/book-api/seats/${r.body.token}/cancel`)).body;
  assert.equal(cancelled.refund_to, 'mpesa');
  assert.equal((await api('GET', '/book-api/seats/not-a-token')).status, 404);
});

test('the money check adds up after all of it', async () => {
  const r = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(r.all_ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.totals.seat_bookings_held, 0);
});

test("the car's position is shared only while it is on a trip, shown to the passenger it is picking", async () => {
  const where = { lat: -1.0922, lng: 37.0124, heading: 90, speed: 12 };
  // Not on a trip (KDA 111A's last trip finished): nothing kept.
  await api('POST', '/crew/road/finish', { token: s.driver });
  assert.deepEqual((await api('POST', '/crew/location', { token: s.driver, body: where })).body, { shared: false });

  await api('POST', '/marshal/cars/arrived', { token: s.marshal, body: { vehicle_id: s.carA.id } });
  await api('POST', `/marshal/cars/${s.carA.id}/left`, { token: s.marshal });
  assert.deepEqual((await api('POST', '/crew/location', { token: s.driver, body: where })).body, { shared: true });
  const before = (await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE '%location%'")).n;
  assert.equal(before, 0, 'not written to the audit log');

  const r = await book(s.p1, { pickup_stop_id: s.juja.id, expected_fare: 400 });
  const car = (await queues()).cars.find((c) => c.plate === 'KDA 111A');
  assert.equal(car.location.lat, -1.0922, 'the marshal sees it');
  await api('POST', `/marshal/seats/${r.body.id}/assign`, { token: s.marshal, body: { load_id: car.load_id } });
  const mine = await seat(s.p1, r.body.id);
  assert.equal(mine.car.location.lng, 37.0124, 'the passenger waiting for it sees it');
  await api('POST', `/passenger/seats/${r.body.id}/cancel`, { token: s.p1.token });
  assert.equal((await seat(s.p1, r.body.id)).car, null, 'not after the booking is over');
  assert.equal((await api('POST', '/crew/location', { token: s.driver, body: { lat: 200, lng: 0 } })).status, 400);
});
