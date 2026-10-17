// Problem reports are a conversation: the reporter and the SACCO office keep writing on the same report.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

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
  return { status: res.status, body: await res.json() };
};
const login = async (phone, password) => (await api('POST', '/auth/login', { body: { phone, password } })).body.token;
const notes = async (token) => (await api('GET', '/notifications', { token })).body.items;
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office Olive', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.passenger = (await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } })).body.token;
  s.other = (await api('POST', '/auth/register', { body: { name: 'Oscar', phone: '0722333555', password: 'pass123' } })).body.token;
  const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711111111', password: 'cond123' } })).body;
  await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', conductor_id: c.id } });
  s.conductor = await login('0711111111', 'cond123');
  s.report = (await api('POST', '/passenger/reports', { token: s.passenger, body: { category: 'other', message: 'My fare did not go through' } })).body;
});
after(() => server.close());

test('the office and the passenger write back and forth on one report', async () => {
  const reply = await api('POST', `/admin/reports/${s.report.id}/messages`, { token: s.admin, body: { message: 'Which car were you in?' } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.messages[0].sender_name, 'Office Olive', 'the office sees who replied');
  assert.ok((await notes(s.passenger)).some((n) => n.title === 'The SACCO office replied to your report'));

  assert.equal((await api('POST', `/passenger/reports/${s.report.id}/messages`, { token: s.passenger, body: { message: 'KDA 123A' } })).status, 201);
  assert.ok((await notes(s.admin)).some((n) => n.title.startsWith('Pat (passenger) wrote on their report')));
  await api('POST', `/admin/reports/${s.report.id}/messages`, { token: s.admin, body: { message: 'Thanks, refunded.' } });

  const [mine] = (await api('GET', '/passenger/reports', { token: s.passenger })).body;
  assert.equal(mine.message, 'My fare did not go through', 'the first message stays on the report');
  assert.deepEqual(
    mine.messages.map((m) => [Boolean(m.from_office), m.message]),
    [[true, 'Which car were you in?'], [false, 'KDA 123A'], [true, 'Thanks, refunded.']],
  );
  assert.equal(mine.messages[0].sender_name, undefined, 'the passenger does not see who in the office wrote');
  assert.equal(mine.handled_by_name, undefined);

  const [office] = (await api('GET', '/admin/reports', { token: s.admin })).body;
  assert.equal(office.messages.length, 3);
});

test('writing on a resolved report opens it again', async () => {
  await api('PATCH', `/admin/reports/${s.report.id}`, { token: s.admin, body: { status: 'resolved' } });
  await api('POST', `/passenger/reports/${s.report.id}/messages`, { token: s.passenger, body: { message: 'The refund has not arrived' } });
  const [mine] = (await api('GET', '/passenger/reports', { token: s.passenger })).body;
  assert.equal(mine.status, 'open');
  assert.ok((await notes(s.admin)).some((n) => n.title.endsWith('opened again')));
});

test('apps from before conversations still reply with office_note, and it joins the conversation', async () => {
  await api('PATCH', `/admin/reports/${s.report.id}`, { token: s.admin, body: { status: 'in_progress', office_note: 'Checking with M-Pesa' } });
  const [mine] = (await api('GET', '/passenger/reports', { token: s.passenger })).body;
  assert.equal(mine.messages.at(-1).message, 'Checking with M-Pesa');
});

test('crew write on their own reports too', async () => {
  const r = (await api('POST', '/crew/reports', { token: s.conductor, body: { category: 'other', message: 'Brake light out' } })).body;
  assert.equal((await api('POST', `/crew/reports/${r.id}/messages`, { token: s.conductor, body: { message: 'Fixed it myself' } })).status, 201);
  assert.equal((await api('GET', '/crew/reports', { token: s.conductor })).body[0].messages[0].message, 'Fixed it myself');
});

test("nobody can write on someone else's report, or an empty message", async () => {
  assert.equal((await api('POST', `/passenger/reports/${s.report.id}/messages`, { token: s.other, body: { message: 'Hi' } })).status, 404);
  assert.equal((await api('POST', `/crew/reports/${s.report.id}/messages`, { token: s.conductor, body: { message: 'Hi' } })).status, 404);
  assert.equal((await api('POST', `/passenger/reports/${s.report.id}/messages`, { token: s.passenger, body: { message: '   ' } })).status, 400);
  assert.equal((await api('POST', `/admin/reports/999/messages`, { token: s.admin, body: { message: 'Hi' } })).status, 404);
  assert.equal((await api('POST', `/admin/reports/${s.report.id}/messages`, { token: s.passenger, body: { message: 'Hi' } })).status, 403);
});
