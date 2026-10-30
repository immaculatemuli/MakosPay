// USSD: passengers without the app or a smartphone pay a fare in the car (by its car number) or book a seat, and pay
// by M-Pesa PIN prompt sent after the USSD session ends; the ticket or booking code comes by SMS.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.SMS_PROVIDER = 'log';
process.env.USSD_PROMPT_DELAY_MS = '0';
process.env.SEAT_BOOKING_CUTOFF = '23:59';
process.env.SEAT_BOOKING_OPENS = '00:00';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');
const { ussdIdle } = await import('../src/services/ussd.js');

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
let session = 0;
/** One USSD screen, as Africa's Talking asks for it. */
const ussd = async (text, { phone = '+254733111222', sessionId = `s${session}`, secret = 'dev-ussd-secret' } = {}) => {
  const res = await fetch(`${base}/ussd/${secret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sessionId, serviceCode: '*384*1#', phoneNumber: phone, text }).toString(),
  });
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
};
const texts = (phone) => db.all('SELECT kind, message FROM sms_outbox WHERE phone = ? ORDER BY id', phone);
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  const route = (name, fare, stops) => api('POST', '/admin/routes', { token: s.admin, body: { name, origin: 'Town', fare, stops } });
  s.thika = (
    await route('Thika Road', 100, [{ name: 'Ruiru' }, { name: 'Juja' }, { name: 'Thika' }])
  ).body;
  s.long = (await route('Long Road', 90, Array.from({ length: 12 }, (_, i) => ({ name: `Stop number ${i + 1}` })))).body;
  const car = (plate, r) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, route_id: r.id, owner_name: 'Mary', owner_phone: '0744555666' } });
  s.car = (await car('KDA 123A', s.thika)).body;
  s.longCar = (await car('KDB 456B', s.long)).body;
});
after(() => server.close());

test('every vehicle gets the next short car number', () => {
  assert.equal(s.car.car_number, 101);
  assert.equal(s.longCar.car_number, 102);
});

test('the first screen offers paying a fare and booking a seat', async () => {
  const r = await ussd('');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/plain/);
  assert.match(r.text, /^CON /);
  assert.match(r.text, /1\. Pay fare\n2\. Book a seat/);
});

test('pay a fare by car number: the prompt asks for exactly the fare, and the ticket comes by SMS', async () => {
  session++;
  assert.match((await ussd('1')).text, /^CON Enter the car number/);
  const stops = await ussd('1*101');
  assert.match(stops.text, /^CON Car 101 \(KDA 123A\)\nWhere do you get off\?\n1\. Ruiru KES 100\n2\. Juja KES 100\n3\. Thika KES 100/);
  assert.match((await ussd('1*101*2')).text, /^CON Pay KES 100 to Juja, Car 101 \(KDA 123A\)\?\n1\. Pay with M-Pesa\n2\. Cancel/);
  const done = await ussd('1*101*2*1');
  assert.match(done.text, /^END An M-Pesa prompt for KES 100 is coming now/);
  await ussdIdle();

  const payment = await db.get("SELECT * FROM mpesa_payments WHERE phone = '254733111222' AND purpose = 'fare'");
  assert.equal(payment.amount, 100);
  assert.equal(payment.channel, 'ussd');
  assert.equal(payment.status, 'completed');
  const trip = await db.get('SELECT * FROM trips WHERE id = ?', payment.trip_id);
  assert.equal(trip.vehicle_id, s.car.id, 'the fare is on that car, for its owner');
  assert.equal(trip.fare, 100);
  const [sms] = (await texts('254733111222')).filter((t) => t.kind === 'ticket');
  assert.match(sms.message, new RegExp(`ticket ${trip.ticket_code}: paid KES 100, car 101 \\(KDA 123A\\) to Juja`));
  const passenger = await db.get("SELECT role, password_hash FROM users WHERE phone = '254733111222'");
  assert.equal(passenger.role, 'passenger');
  assert.equal(passenger.password_hash, 'no-app-passenger', 'a passenger without the app, who can sign up later');
});

test('the same confirmation sent twice starts one payment only', async () => {
  session++;
  await ussd('1*101*1*1');
  await ussd('1*101*1*1');
  await ussdIdle();
  const n = (await db.get("SELECT COUNT(*) AS n FROM mpesa_payments WHERE idempotency_key = ?", `ussd-s${session}`)).n;
  assert.equal(n, 1);
});

test('a wrong car number, a wrong choice and Cancel end the session without paying', async () => {
  session++;
  assert.match((await ussd('1*999')).text, /^END Car 999 was not found/);
  assert.match((await ussd('1*101*9')).text, /^END That is not one of the choices/);
  assert.match((await ussd('1*101*1*2')).text, /^END Cancelled\. Nothing was paid\./);
  assert.match((await ussd('7')).text, /^END /);
  await ussdIdle();
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM mpesa_payments WHERE idempotency_key = ?', `ussd-s${session}`)).n, 0);
});

test('a staff phone number is told on the screen it cannot pay', async () => {
  session++;
  assert.match((await ussd('1*101*1*1', { phone: '+254700000001' })).text, /^END This number belongs to a FarePay staff account/);
});

test('a long list of stops goes on pages, and numbers keep their meaning', async () => {
  session++;
  const first = await ussd('1*102');
  assert.match(first.text, /\n0\. More$/);
  assert.ok(first.text.length <= 186, `fits one screen (${first.text.length})`);
  const shown = first.text.match(/^\d+\. Stop/gm).length;
  const second = await ussd('1*102*0');
  assert.match(second.text, new RegExp(`\\n${shown + 1}\\. Stop number ${shown + 1} `));
  assert.match((await ussd(`1*102*0*${shown + 1}`)).text, new RegExp(`^CON Pay KES 90 to Stop number ${shown + 1},`));
  assert.match((await ussd('1*102*0*1')).text, /^END That is not one of the choices/, 'page 1 numbers are not on page 2');
});

test('book a seat at the stage: priced fare × seats, paid by prompt, joins the queue, code by SMS', async () => {
  session++;
  const phone = '+254733444555';
  const routes = (await ussd('2', { phone })).text;
  const n = routes.match(/(\d+)\. Thika Road/)[1];
  assert.match((await ussd(`2*${n}`, { phone })).text, /^CON Where do you get off\?\n1\. Ruiru KES 100\n2\. Juja KES 100/);
  assert.match((await ussd(`2*${n}*2`, { phone })).text, /^CON Where will you board\?\n1\. At Town stage\n2\. On the road, before Juja/);
  assert.match((await ussd(`2*${n}*2*1`, { phone })).text, /^CON How many seats\?/);
  assert.match((await ussd(`2*${n}*2*1*2`, { phone })).text, /^CON Book 2 seats to Juja, at Town stage: KES 200\?/);
  assert.match((await ussd(`2*${n}*2*1*2*1`, { phone })).text, /^END An M-Pesa prompt for KES 200 is coming now/);
  await ussdIdle();

  const b = await db.get("SELECT * FROM seat_bookings WHERE idempotency_key = ?", `ussd-s${session}`);
  assert.equal(b.seats, 2);
  assert.equal(b.amount, 200);
  assert.equal(b.pickup_stop_id, null);
  assert.equal(b.status, 'queued', 'paid and in the queue');
  assert.ok((await texts('254733444555')).some((t) => t.kind === 'seat.queued' && t.message.includes(b.code)));
});

test('book a seat to be picked on the road, before the drop-off', async () => {
  session++;
  const phone = '+254733666777';
  const n = (await ussd('2', { phone })).text.match(/(\d+)\. Thika Road/)[1];
  assert.match((await ussd(`2*${n}*3*2`, { phone })).text, /^CON Where should the car pick you\?\n1\. Ruiru\n2\. Juja$/);
  assert.match((await ussd(`2*${n}*3*2*2*1`, { phone })).text, /^CON Book 1 seat to Thika, pick-up at Juja: KES 100\?/);
  await ussd(`2*${n}*3*2*2*1*1`, { phone });
  await ussdIdle();
  const b = await db.get("SELECT * FROM seat_bookings WHERE idempotency_key = ?", `ussd-s${session}`);
  const juja = s.thika.stops.find((x) => x.name === 'Juja');
  assert.equal(b.pickup_stop_id, juja.id);
  assert.equal(b.amount, 100, "the route's one fare");
});

test('a drop-off at the first stop has no road pickup to ask about', async () => {
  session++;
  const n = (await ussd('2')).text.match(/(\d+)\. Thika Road/)[1];
  assert.match((await ussd(`2*${n}*1`)).text, /^CON How many seats\?/);
});

test('only Africa’s Talking (with the secret address) can use it', async () => {
  assert.equal((await ussd('', { secret: 'wrong-secret' })).status, 404);
});
