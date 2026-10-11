// Step 2: the SACCO office sets up routes, conductors and vehicles (with the owner's M-Pesa number).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

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
  const p = (await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722222222', password: 'pass123' } })).body.token;
  assert.equal((await api('GET', '/admin/routes', { token: p })).status, 403);
  assert.equal((await api('GET', '/admin/routes')).status, 401);
});

test('routes: drop-off stops, each with its own cash fare and lower app fare', async () => {
  const bad = await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Route 46', origin: 'Town', stops: [{ name: 'Kawangware', cash_fare: 80, app_fare: 90 }] },
  });
  assert.equal(bad.status, 400, 'app fare above cash fare is refused');
  const none = await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Route 46', origin: 'Town', stops: [] } });
  assert.equal(none.status, 400, 'a route needs at least one stop');

  const route = await api('POST', '/admin/routes', {
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
  });
  assert.equal(route.status, 201, JSON.stringify(route.body));
  assert.deepEqual(route.body.stops.map((st) => [st.name, st.cash_fare, st.app_fare]), [['Ruiru', 60, 50], ['Juja', 80, 70], ['Thika', 100, 90]]);
  s.route = route.body;
});

test('routes: edit fares, add a stop and remove one', async () => {
  const [ruiru, juja, thika] = s.route.stops;
  const edited = await api('PATCH', `/admin/routes/${s.route.id}`, {
    token: s.admin,
    body: {
      stops: [
        { id: ruiru.id, name: 'Ruiru', cash_fare: 60, app_fare: 50 },
        { name: 'Kenol', cash_fare: 70, app_fare: 60 },
        { id: thika.id, name: 'Thika', cash_fare: 120, app_fare: 100 },
      ],
    },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.stops.map((st) => [st.name, st.app_fare]), [['Ruiru', 50], ['Kenol', 60], ['Thika', 100]]);
  assert.ok(!edited.body.stops.some((st) => st.id === juja.id), 'Juja removed from the list');

  const dupes = await api('PATCH', `/admin/routes/${s.route.id}`, {
    token: s.admin,
    body: { stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }, { name: 'ruiru', cash_fare: 60, app_fare: 50 }] },
  });
  assert.equal(dupes.status, 400, 'two stops with the same name are refused');
  assert.equal((await api('GET', '/admin/routes', { token: s.admin })).body.length, 1);
});

test('conductors: the office creates the account and the conductor can sign in', async () => {
  const c = await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian Conductor', phone: '0711111111', password: 'cond123' } });
  assert.equal(c.status, 201);
  s.conductor = c.body;
  const login = await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'cond123' } });
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

  const rotated = await api('POST', `/admin/vehicles/${s.vehicle.id}/rotate-qr`, { token: s.admin });
  assert.notEqual(rotated.body.qr_token, s.vehicle.qr_token);
});

test('disabling a conductor frees their vehicle and blocks their sign-in', async () => {
  const off = await api('PATCH', `/admin/conductors/${s.conductor.id}`, { token: s.admin, body: { is_active: false } });
  assert.equal(off.body.is_active, 0);
  const vehicle = await api('GET', `/admin/vehicles/${s.vehicle.id}`, { token: s.admin });
  assert.equal(vehicle.body.conductor_id, null);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'cond123' } })).status, 403);
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

  const r = await api('POST', `/admin/users/${found[0].id}/password`, { token: s.admin, body: { new_password: 'fresh123' } });
  assert.equal(r.status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0722222222', password: 'fresh123' } })).status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0722222222', password: 'pass123' } })).status, 401);

  const adminId = (await api('GET', '/auth/me', { token: s.admin })).body.user.id;
  assert.equal((await api('POST', `/admin/users/${adminId}/password`, { token: s.admin, body: { new_password: 'nope123' } })).status, 404, 'not for office accounts');
});
