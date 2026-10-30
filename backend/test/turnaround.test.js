// At the end of its route a car turns around by itself: Nairobi - Wote becomes Wote - Nairobi when the trip is over,
// so passengers at Wote pay and book the way back without the conductor changing the route.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');
const { closeStaleTrips } = await import('../src/services/bookings.js');

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
const routeOfCar = async () => (await db.get('SELECT r.name FROM vehicles v JOIN routes r ON r.id = v.route_id WHERE v.id = ?', s.car.id)).name;
const trip = async () => {
  await api('POST', '/crew/loading/start', { token: s.crew });
  await api('POST', '/crew/loading/depart', { token: s.crew });
};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  const route = async (name, origin, fare, stops) =>
    (await api('POST', '/admin/routes', { token: s.admin, body: { name, origin, fare, stops: stops.map((n) => ({ name: n })) } })).body;
  s.out = await route('Nairobi - Wote', 'Nairobi', 500, ['Machakos', 'Wote']);
  s.back = await route('Wote - Nairobi', 'Wote', 500, ['Machakos', 'Nairobi']);
  s.machakos = await route('Nairobi - Machakos', 'Nairobi', 250, ['Athi River', 'Machakos']);
  const conductor = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian Conductor', phone: '0711000001', password: 'Acond123' } })).body;
  s.car = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Owner', owner_phone: '0744555666', route_id: s.out.id, conductor_id: conductor.id } })).body;
  s.crew = await login('0711000001', 'Acond123');
});
after(() => server.close());

test('finishing the trip puts the car on the way back, and the conductor is told', async () => {
  await trip();
  assert.equal(await routeOfCar(), 'Nairobi - Wote', 'on the road: still the way out');
  assert.equal((await api('POST', '/crew/road/finish', { token: s.crew })).status, 200);
  assert.equal(await routeOfCar(), 'Wote - Nairobi');
  const note = (await api('GET', '/notifications', { token: s.crew })).body.items[0];
  assert.equal(note.title, 'KDA 123A is now on Wote - Nairobi');
  assert.match(note.body, /KES 500/);
});

test('loading at the far stage without finishing the trip loads for the way back', async () => {
  await trip(); // Wote → Nairobi, not marked finished
  const loading = await api('POST', '/crew/loading/start', { token: s.crew });
  assert.ok(loading.status < 300, JSON.stringify(loading.body));
  assert.equal(await routeOfCar(), 'Nairobi - Wote');
  assert.equal((await db.get("SELECT route_id FROM loads WHERE vehicle_id = ? AND status = 'loading'", s.car.id)).route_id, s.out.id, 'the new load is on the way out');
  await api('POST', '/crew/loading/depart', { token: s.crew });
});

test('a route the conductor chose is kept, and a route with no way back stays', async () => {
  await api('POST', '/crew/road/finish', { token: s.crew }); // now Wote - Nairobi
  await api('PUT', '/crew/vehicle/route', { token: s.crew, body: { route_id: s.machakos.id } });
  await trip(); // Nairobi → Machakos: there is no Machakos - Nairobi route
  await api('POST', '/crew/road/finish', { token: s.crew });
  assert.equal(await routeOfCar(), 'Nairobi - Machakos');

  await api('PUT', '/crew/vehicle/route', { token: s.crew, body: { route_id: s.out.id } });
  await trip(); // Nairobi → Wote, but the conductor already switched before finishing
  await api('PUT', '/crew/vehicle/route', { token: s.crew, body: { route_id: s.machakos.id } });
  await api('POST', '/crew/road/finish', { token: s.crew });
  assert.equal(await routeOfCar(), 'Nairobi - Machakos', 'not turned: the crew had chosen');
});

test('at night a car on the road turns around; a car still at the stage does not', async () => {
  await api('PUT', '/crew/vehicle/route', { token: s.crew, body: { route_id: s.out.id } });
  await trip();
  await closeStaleTrips();
  assert.equal(await routeOfCar(), 'Wote - Nairobi');

  await api('POST', '/crew/loading/start', { token: s.crew }); // loading at Wote, never left
  await closeStaleTrips();
  assert.equal(await routeOfCar(), 'Wote - Nairobi');
});
