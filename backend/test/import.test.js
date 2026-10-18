// Loading routes, crew and vehicles from a spreadsheet: every row checked first, nothing saved unless all are right.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

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
  return { status: res.status, body: await res.json() };
};
const s = {};
const load = (kind, rows, commit = false) => api('POST', `/admin/import/${kind}`, { token: s.admin, body: { rows, commit } });
const count = async (table) => (await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
});
after(() => server.close());

const ROUTES = [
  { Route: 'Nairobi - Machakos', 'Starts from': 'Town', Stop: 'Mlolongo', 'Cash fare': '150', 'App fare': '140' },
  { Route: 'Nairobi - Machakos', 'Starts from': 'Town', Stop: 'Machakos', 'Cash fare': '400', 'App fare': '' },
  { Route: 'Thika Road', 'Starts from': 'Town', Stop: 'Juja', 'Cash fare': '120', 'App fare': '100' },
];

test('routes: checked, then saved in one go with stops in order', async () => {
  const bad = await load('routes', [...ROUTES, { Route: 'Thika Road', 'Starts from': 'Ruiru', Stop: 'Juja', 'Cash fare': 'abc' }]);
  assert.equal(bad.body.ok, false);
  const errors = bad.body.rows.find((r) => r.row === 5).errors.join(' | ');
  assert.match(errors, /Cash fare/);
  assert.match(errors, /Starts from differs from row 4/);
  assert.match(errors, /Juja is already a stop/);
  assert.equal((await load('routes', ROUTES.concat({ Route: 'X', Stop: 'Y', 'Cash fare': '50' }), true)).body.saved, false, 'a bad row stops everything');
  assert.equal(await count('routes'), 0);

  const ok = await load('routes', ROUTES, true);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.summary, '2 routes with 3 stops');
  const stops = await db.all("SELECT s.name, s.app_fare FROM route_stops s JOIN routes r ON r.id = s.route_id WHERE r.name = 'Nairobi - Machakos' ORDER BY s.position");
  assert.deepEqual(stops.map((x) => [x.name, x.app_fare]), [['Mlolongo', 140], ['Machakos', 400]], 'empty app fare = the cash fare');
  assert.match((await load('routes', ROUTES)).body.rows[0].errors[0], /already exists/);
});

test('crew: passwords made for those without one, shown once', async () => {
  const rows = [
    { Name: 'Dan Driver', Phone: '0711000001', Role: 'Driver', Password: '' },
    { Name: 'Kim Kondakta', Phone: '0711000002', Role: 'kondakta', Password: 'secret99' },
    { Name: 'Mary Marshal', Phone: '0711000003', Role: 'Marshal', Password: '' },
  ];
  const bad = await load('crew', [...rows, { Name: 'Dup', Phone: '0711 000 001', Role: 'pilot' }]);
  assert.match(bad.body.rows[3].errors.join(' | '), /Same phone as row 2/);
  assert.match(bad.body.rows[3].errors.join(' | '), /Role must be/);
  const ok = await load('crew', rows, true);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.summary, '1 driver, 1 conductor, 1 stage marshal');
  const dan = ok.body.created.find((p) => p.name === 'Dan Driver');
  assert.match(dan.password, /^Makos-\d{6}$/);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0711000001', password: dan.password } })).status, 200, 'the made password works');
  assert.equal(ok.body.created.find((p) => p.role === 'conductor').password, '(from the file)');
  const audit = await db.get("SELECT details FROM audit_log WHERE action = 'import.crew'");
  assert.ok(audit && !audit.details.includes(dan.password), 'passwords stay out of the audit log');
});

test('vehicles: routes and crew found by name and phone; owners by M-Pesa or bank', async () => {
  const rows = [
    { Plate: 'kda 123a', Seats: '14', Route: 'Thika Road', 'Owner name': 'Mary', 'Owner phone': '0744555666', 'Paid by': 'M-Pesa', 'Driver phone': '0711000001', 'Conductor phone': '' },
    { Plate: 'KDB 222B', Seats: '', Route: 'Nairobi - Machakos', 'Owner name': 'John', 'Owner phone': '0755666777', 'Paid by': 'Bank', 'Bank name': 'KCB', 'Bank paybill': '522522', 'Bank account': '1234567890' },
  ];
  const bad = await load('vehicles', [...rows, { Plate: 'KDA 123A', Route: 'Mombasa', 'Owner name': 'X', 'Owner phone': '123', 'Paid by': 'Bank', 'Driver phone': '0711000001' }]);
  const errors = bad.body.rows[2].errors.join(' | ');
  for (const re of [/Same plate as row 2/, /No route called Mombasa/, /Owner name is empty/, /Owner phone/, /Bank name is needed/, /Same driver as row 2/]) assert.match(errors, re);

  const ok = await load('vehicles', rows, true);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const v = await db.get("SELECT v.*, r.name AS route_name FROM vehicles v JOIN routes r ON r.id = v.route_id WHERE plate = 'KDA 123A'");
  assert.equal(v.route_name, 'Thika Road');
  assert.ok(v.driver_id, 'driver linked');
  assert.ok(v.qr_token, 'QR sticker made');
  const bankCar = await db.get("SELECT owner_payout_method, owner_bank_paybill, seats FROM vehicles WHERE plate = 'KDB 222B'");
  assert.deepEqual({ ...bankCar }, { owner_payout_method: 'bank', owner_bank_paybill: '522522', seats: 14 });
});

test('every sticker on one page; unknown columns and empty files are explained', async () => {
  const sheet = (await api('GET', '/admin/vehicles/stickers', { token: s.admin })).body;
  assert.deepEqual(sheet.vehicles.map((v) => v.plate), ['KDA 123A', 'KDB 222B']);
  assert.equal((await load('crew', [{ Foo: 'bar' }])).body.error.code, 'NO_COLUMNS');
  assert.equal((await load('crew', [])).body.error.code, 'NO_ROWS');
  assert.equal((await load('planes', [{ a: 1 }])).status, 400);
  assert.deepEqual((await api('GET', '/admin/import/templates', { token: s.admin })).body.crew, ['Name', 'Phone', 'Role', 'Password']);
});
