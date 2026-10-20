// Letting the database sleep while nobody uses FarePay: background jobs run while it is in use, then wait unless
// something is due at a known time; /health (the hosting's checks and the keep-awake ping) never touches the
// database and doesn't count as use.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.QUIET_AFTER_MINUTES = '15';

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const quiet = await import('../src/services/quiet.js');
const { nextSeatTimerAt } = await import('../src/services/seats.js');
const { nextWithdrawalRetryAt } = await import('../src/services/withdrawals.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const MIN = 60_000;

test('jobs run while FarePay is in use, and wait once it has been quiet for 15 minutes', () => {
  quiet.noteActivity();
  const now = Date.now();
  assert.equal(quiet.shouldRun(null, now + 14 * MIN), true, 'still in use');
  assert.equal(quiet.shouldRun(null, now + 16 * MIN), false, 'quiet: nothing due');
  assert.equal(quiet.shouldRun(now + 30 * MIN, now + 16 * MIN), false, 'quiet: due later');
  assert.equal(quiet.shouldRun(now + 30 * MIN, now + 31 * MIN), true, 'quiet, but its time has come');
});

test('/health answers without the database and is not counted as use; other requests are', async () => {
  const realGet = db.get;
  let queries = 0;
  db.get = (...args) => {
    queries++;
    return realGet(...args);
  };
  try {
    const before = Date.now();
    // Pretend FarePay has been quiet for an hour.
    quiet.noteActivity();
    const hourAgo = Date.now() + 60 * MIN;
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal(queries, 0, 'no database query');
    assert.equal(quiet.recentlyActive(hourAgo), false, 'the ping did not count as use');
    assert.equal((await fetch(`${base}/health/db`)).status, 200);
    assert.ok(queries >= 1, '/health/db asks the database');
    await fetch(`${base}/book-api/seat-routes`);
    assert.equal(quiet.recentlyActive(Date.now() + 14 * MIN), true, 'a real request counts');
    assert.ok(Date.now() >= before);
  } finally {
    db.get = realGet;
  }
});

test('a quiet server knows when the next seat reminder or refund retry is due', async () => {
  assert.equal(await nextSeatTimerAt(), null, 'nothing booked for later');
  assert.equal(await nextWithdrawalRetryAt(), null, 'no retry waiting');
});
