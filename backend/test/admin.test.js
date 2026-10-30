// Step 2: the SACCO office sets up routes, conductors and vehicles (with the owner's M-Pesa number).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');

let server;
let base;
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
});
after(() => server.close());

test('only the SACCO office can use these screens', async () => {
  const p = (await signUp(api, { name: 'Pat', phone: '0722222222', password: 'Apass123' })).body.token;
  assert.equal((await api('GET', '/admin/routes', { token: p })).status, 403);
  assert.equal((await api('GET', '/admin/routes')).status, 401);
});

test('routes: one fixed fare for the whole route, whichever stop the passenger gets off at', async () => {
  const bad = await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Route 46', origin: 'Town', stops: [{ name: 'Kawangware', cash_fare: 80, app_fare: 90 }] },
  });
  assert.equal(bad.status, 400, 'app fare above cash fare is refused');
  const none = await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Route 46', origin: 'Town', stops: [] } });
  assert.equal(none.status, 400, 'a route needs at least one stop');
  const noFare = await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Route 46', origin: 'Town', stops: [{ name: 'Kawangware' }] } });
  assert.equal(noFare.status, 400, 'a route needs a fare');

  // Older apps still send a fare with each stop: the last stop's fare is the route's fare, on every stop.
  const route = await api('POST', '/admin/routes', {
    token: s.admin,
    body: {
      name: 'Thika Road',
      origin: 'Town',
      stops: [
        { name: 'Ruiru', cash_fare: 60, app_fare: 50 },
        { name: 'Juja', cash_fare: 80, app_fare: 70 },
        { name: 'Thika', fare: 90 },
      ],
    },
  });
  assert.equal(route.status, 201, JSON.stringify(route.body));
  assert.equal(route.body.fare, 90);
  assert.deepEqual(route.body.stops.map((st) => [st.name, st.fare]), [['Ruiru', 90], ['Juja', 90], ['Thika', 90]]);
  s.route = route.body;

  // Its way back is added too, so cars turn around at Thika: same fare, the stops in reverse, ending in Town.
  const back = (await api('GET', '/admin/routes', { token: s.admin })).body.find((r) => r.name === 'Thika - Town');
  assert.deepEqual([back.origin, back.fare, back.stops.map((st) => st.name)], ['Thika', 90, ['Juja', 'Ruiru', 'Town']]);
  s.wayBack = back;
});

test('routes: change the fare, add a stop and remove one', async () => {
  const [ruiru, juja, thika] = s.route.stops;
  const edited = await api('PATCH', `/admin/routes/${s.route.id}`, {
    token: s.admin,
    body: { fare: 100, stops: [{ id: ruiru.id, name: 'Ruiru' }, { name: 'Kenol' }, { id: thika.id, name: 'Thika' }] },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.stops.map((st) => [st.name, st.app_fare]), [['Ruiru', 100], ['Kenol', 100], ['Thika', 100]]);
  assert.ok(!edited.body.stops.some((st) => st.id === juja.id), 'Juja removed from the list');
  const history = (await api('GET', `/admin/routes/${s.route.id}/fare-changes`, { token: s.admin })).body;
  assert.deepEqual(history.map((f) => [f.old_app_fare, f.new_app_fare]), [[90, 100]], 'one fare history entry for the route');

  // A fare from a later day is for the whole route too.
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const later = await api('POST', `/admin/routes/${s.route.id}/fare-change`, { token: s.admin, body: { fare: 120, effective_date: today } });
  assert.equal(later.status, 201, JSON.stringify(later.body));
  assert.deepEqual((await api('GET', `/admin/routes/${s.route.id}`, { token: s.admin })).body.stops.map((st) => st.fare), [120, 120, 120]);

  const dupes = await api('PATCH', `/admin/routes/${s.route.id}`, {
    token: s.admin,
    body: { stops: [{ name: 'Ruiru' }, { name: 'ruiru' }] },
  });
  assert.equal(dupes.status, 400, 'two stops with the same name are refused');
  assert.deepEqual((await api('GET', '/admin/routes', { token: s.admin })).body.map((r) => r.name), ['Thika - Town', 'Thika Road'], 'editing did not add a second way back');

  // A way back the office switches off stays off.
  await api('PATCH', `/admin/routes/${s.wayBack.id}`, { token: s.admin, body: { is_active: false } });
  await api('PATCH', `/admin/routes/${s.route.id}`, { token: s.admin, body: { name: 'Thika Road' } });
  assert.deepEqual((await api('GET', '/admin/routes', { token: s.admin })).body.map((r) => [r.name, r.is_active]), [['Thika Road', 1], ['Thika - Town', 0]]);
});

test('conductors: the office creates the account and the conductor can sign in', async () => {
  const c = await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian Conductor', phone: '0711111111', password: 'Acond123' } });
  assert.equal(c.status, 201);
  s.conductor = c.body;
  const login = await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'Acond123' } });
  assert.equal(login.body.user.role, 'conductor');
});

test('vehicles: plate, owner name and M-Pesa number, conductor and route', async () => {
  const v = await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: {
      plate: 'kda  123a',
      description: 'White Nissan "Baraka"',
      owner_name: 'Mary Owner',
      owner_phone: '0744 555 666',
      conductor_id: s.conductor.id,
      route_id: s.route.id,
    },
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.plate, 'KDA 123A');
  assert.equal(v.body.owner_phone, '254744555666');
  assert.equal(v.body.conductor_name, 'Ian Conductor');
  assert.equal(v.body.route_name, 'Thika Road');
  s.vehicle = v.body;

  const dupe = await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'X Y', owner_phone: '0700111222' } });
  assert.equal(dupe.status, 409);

  const second = await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KCB 456B', owner_name: 'John Owner', owner_phone: '0700111222', conductor_id: s.conductor.id },
  });
  assert.equal(second.status, 409, 'a conductor works on one vehicle at a time');
});

test('the QR sticker can be shown, and replaced so the old one stops working', async () => {
  const png = await api('GET', `/admin/vehicles/${s.vehicle.id}/qr.png`, { token: s.admin });
  assert.equal(png.status, 200);
  assert.ok(png.body.length > 500);

  // What the app shows: the same picture inside JSON, ready to display and share.
  const qr = await api('GET', `/admin/vehicles/${s.vehicle.id}/qr`, { token: s.admin });
  assert.equal(qr.status, 200);
  assert.equal(qr.body.file_name, 'FarePay-QR-KDA_123A.png');
  assert.equal(Buffer.from(qr.body.png_base64, 'base64').subarray(1, 4).toString(), 'PNG');
  assert.equal((await api('GET', `/admin/vehicles/${s.vehicle.id}/qr`)).status, 401);

  const rotated = await api('POST', `/admin/vehicles/${s.vehicle.id}/rotate-qr`, { token: s.admin });
  assert.notEqual(rotated.body.qr_token, s.vehicle.qr_token);
});

test('disabling a conductor frees their vehicle and blocks their sign-in', async () => {
  const off = await api('PATCH', `/admin/conductors/${s.conductor.id}`, { token: s.admin, body: { is_active: false } });
  assert.equal(off.body.is_active, 0);
  const vehicle = await api('GET', `/admin/vehicles/${s.vehicle.id}`, { token: s.admin });
  assert.equal(vehicle.body.conductor_id, null);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'Acond123' } })).status, 403);
});

test('home dashboard counts what is set up', async () => {
  const { body } = await api('GET', '/admin/summary', { token: s.admin });
  assert.deepEqual(body, {
    routes: 1,
    vehicles: 1,
    vehicles_without_route: 0,
    conductors: 0,
    drivers: 0,
    passengers: 1,
    today: { payments: 0, total: 0, by_vehicle: [] },
    owed_to_owners: 0,
    open_reports: 0,
  });
});

test('the office finds passengers and sets a new password for one who forgot it', async () => {
  const found = (await api('GET', '/admin/passengers?q=0722', { token: s.admin })).body;
  assert.deepEqual(found.map((p) => p.name), ['Pat']);
  assert.equal(found[0].wallet_balance, 0);
  assert.deepEqual((await api('GET', '/admin/passengers?q=nobody', { token: s.admin })).body, []);

  const r = await api('POST', `/admin/users/${found[0].id}/password`, { token: s.admin, body: { new_password: 'Afresh123' } });
  assert.equal(r.status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0722222222', password: 'Afresh123' } })).status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0722222222', password: 'Apass123' } })).status, 401);

  const adminId = (await api('GET', '/auth/me', { token: s.admin })).body.user.id;
  assert.equal((await api('POST', `/admin/users/${adminId}/password`, { token: s.admin, body: { new_password: 'Anope123' } })).status, 404, 'not for office accounts');
});
