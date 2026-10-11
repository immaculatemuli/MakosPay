// Step 3: the passenger chooses a route, scans the vehicle's QR code and pays from the wallet.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/db.js');
const { postWalletEntry } = await import('../src/services/wallet.js');

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
const s = {};
const pay = (key = randomUUID(), fare = 70, stopId = s.juja.id) =>
  api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.qr, stop_id: stopId, expected_fare: fare, idempotency_key: key } });
const scan = (stopId) =>
  api('GET', `/passenger/scan?qr=${encodeURIComponent(s.qr)}${stopId ? `&stop_id=${stopId}` : ''}`, { token: s.passenger });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: {
      name: 'Thika Road',
      origin: 'Town',
      stops: [
        { name: 'Ruiru', cash_fare: 60, app_fare: 50 },
        { name: 'Juja', cash_fare: 80, app_fare: 70 },
        { name: 'Thika', cash_fare: 100, app_fare: 90 },
      ],
    },
  })).body;
  [s.ruiru, s.juja, s.thika] = s.route.stops;
  s.other = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Route 46', origin: 'Town', stops: [{ name: 'Kawangware', cash_fare: 70, app_fare: 60 }] },
  })).body;
  const conductor = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian Conductor', phone: '0711111111', password: 'cond123' } })).body;
  s.vehicle = (await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KDA 123A', description: 'White Nissan', owner_name: 'Mary Owner', owner_phone: '0744555666', conductor_id: conductor.id, route_id: s.route.id },
  })).body;
  s.qr = `farepay://pay?v=${s.vehicle.qr_token}`;
  s.passenger = (await api('POST', '/auth/register', { body: { name: 'Pat Passenger', phone: '0722222222', password: 'pass123' } })).body.token;
});
after(() => server.close());


test('the passenger sees routes with their drop-off stops and fares', async () => {
  assert.equal((await api('GET', '/passenger/wallet', { token: s.passenger })).body.balance, 0);
  const routes = (await api('GET', '/passenger/routes', { token: s.passenger })).body;
  assert.deepEqual(
    routes.map((r) => [r.name, r.stops.map((st) => `${st.name} ${st.app_fare} (save ${st.you_save})`)]),
    [
      ['Route 46', ['Kawangware 60 (save 10)']],
      ['Thika Road', ['Ruiru 50 (save 10)', 'Juja 70 (save 10)', 'Thika 90 (save 10)']],
    ],
  );
});

test('scanning shows the vehicle, conductor, route and the fare to the chosen drop-off', async () => {
  const q = (await scan(s.juja.id)).body;
  assert.equal(q.vehicle.plate, 'KDA 123A');
  assert.equal(q.vehicle.description, 'White Nissan');
  assert.equal(q.vehicle.conductor_name, 'Ian Conductor');
  assert.equal(q.route.name, 'Thika Road');
  assert.deepEqual(q.route.stops.map((st) => st.name), ['Ruiru', 'Juja', 'Thika']);
  assert.deepEqual(q.stop, { id: s.juja.id, name: 'Juja' });
  assert.equal(q.fare, 70);
  assert.equal(q.you_save, 10);
  assert.equal(q.can_pay, false);
  assert.equal(q.shortfall, 70);
  assert.equal(q.chosen_elsewhere, null);
  assert.equal(q.vehicle.owner_phone, undefined, "owner's number is not shown to passengers");
});

test('without a drop-off, or with one on another route, the passenger is asked to pick', async () => {
  const none = (await scan()).body;
  assert.equal(none.stop, null);
  assert.equal(none.fare, null);

  const elsewhere = (await scan(s.other.stops[0].id)).body;
  assert.equal(elsewhere.stop, null);
  assert.deepEqual(elsewhere.chosen_elsewhere, { route_name: 'Route 46', stop_name: 'Kawangware' });
});

test('a bad QR code is refused', async () => {
  const r = await api('GET', '/passenger/scan?qr=not-a-farepay-code', { token: s.passenger });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'INVALID_QR');
});

test('paying with an empty wallet is refused', async () => {
  const r = await pay();
  assert.equal(r.status, 402);
  assert.equal(r.body.error.code, 'INSUFFICIENT_FUNDS');
});

test('paying to a stop that is not on the vehicle route is refused', async () => {
  const r = await pay(randomUUID(), 60, s.other.stops[0].id);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'WRONG_STOP');
});

test('paying from the wallet takes the drop-off fare and gives a ticket', async () => {
  const userId = db.prepare("SELECT id FROM users WHERE phone = '254722222222'").get().id;
  tx(() => postWalletEntry(userId, { type: 'test_credit', amount: 500, description: 'Test credit' }));

  const key = randomUUID();
  const r = await pay(key);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.trip.ticket_code, /^[A-Z2-9]{6}$/);
  assert.equal(r.body.trip.plate, 'KDA 123A');
  assert.equal(r.body.trip.stop_name, 'Juja');
  assert.equal(r.body.trip.fare, 70);
  assert.equal(r.body.wallet_balance, 430);
  s.ticket = r.body.trip.ticket_code;

  const again = await pay(key);
  assert.equal(again.status, 200, 'a retry of the same confirmation...');
  assert.equal(again.body.trip.ticket_code, s.ticket);
  assert.equal(again.body.wallet_balance, 430, '...does not charge twice');
});

test('the owner of the vehicle at the time is recorded on the trip', async () => {
  const trip = db.prepare('SELECT owner_name, owner_phone FROM trips WHERE ticket_code = ?').get(s.ticket);
  assert.deepEqual({ ...trip }, { owner_name: 'Mary Owner', owner_phone: '254744555666' });
});

test('scanning again soon after paying warns about paying twice', async () => {
  assert.equal((await scan(s.juja.id)).body.recent_payment.ticket_code, s.ticket);
});

test('if the fare changed since the scan, the passenger is asked to confirm again', async () => {
  await api('PATCH', `/admin/routes/${s.route.id}`, {
    token: s.admin,
    body: {
      stops: [
        { id: s.ruiru.id, name: 'Ruiru', cash_fare: 60, app_fare: 50 },
        { id: s.juja.id, name: 'Juja', cash_fare: 90, app_fare: 80 },
        { id: s.thika.id, name: 'Thika', cash_fare: 100, app_fare: 90 },
      ],
    },
  });
  const r = await pay(randomUUID(), 70);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'FARE_CHANGED');
  assert.equal((await api('GET', '/passenger/wallet', { token: s.passenger })).body.balance, 430, 'nothing charged');
});

test('trip and wallet history', async () => {
  const trips = (await api('GET', '/passenger/trips', { token: s.passenger })).body;
  assert.equal(trips.items.length, 1);
  assert.equal(trips.items[0].ticket_code, s.ticket);
  assert.equal(trips.items[0].stop_name, 'Juja');
  assert.equal(trips.items[0].owner_phone, undefined);
  const txs = (await api('GET', '/passenger/wallet/transactions', { token: s.passenger })).body.items;
  assert.deepEqual(txs.map((t) => [t.type, t.amount, t.balance_after]), [['fare', -70, 430], ['test_credit', 500, 500]]);
});
