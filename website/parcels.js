// Track a parcel by its tracking code. Shown as plain text only (textContent). The code can come in the address
// (/parcels.html?code=ABCD2345), so a link can be shared.
'use strict';

const $ = (id) => document.getElementById(id);
const when = (iso) => new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
const hm = (iso) => new Date(iso).toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' });

const STATUS = {
  awaiting_payment: 'Waiting for payment at the office',
  received: 'At the office, waiting for a car',
  on_the_way: 'On the way',
  arrived: 'Arrived: ready to collect',
  collected: '✓ Collected',
  cancelled: 'Cancelled',
};

let timer = null;

function line(p) {
  if (p.status === 'on_the_way') return `On ${p.plate}${p.expected_at ? `, expected at ${p.to} about ${hm(p.expected_at)}` : ''}.`;
  if (p.status === 'arrived') return `It is at ${p.to}. The receiver collects it with the 6-digit collection code.`;
  if (p.status === 'received') return `It goes on the next car to ${p.to}.`;
  if (p.status === 'collected') return 'The receiver has collected this parcel.';
  if (p.status === 'cancelled') return 'This parcel was cancelled at the office.';
  return 'The sender has not paid the fee yet.';
}

function render(p) {
  $('r-status').textContent = STATUS[p.status] ?? p.status;
  $('r-code').textContent = p.tracking_code;
  $('r-trip').textContent = `${p.from} → ${p.to} (${p.route})`;
  $('r-people').textContent = `From ${p.sender} to ${p.receiver}`;
  $('r-line').textContent = line(p);
  const list = $('r-events');
  list.replaceChildren();
  for (const e of p.events) {
    const li = document.createElement('li');
    li.className = 'done';
    const what = document.createElement('span');
    what.className = 'stop-name';
    what.textContent = e.what;
    const at = document.createElement('span');
    at.className = 'stop-time';
    at.textContent = when(e.at);
    li.append(what, at);
    list.append(li);
  }
  $('result').hidden = false;
}

async function track(code, { quiet = false } = {}) {
  clearTimeout(timer);
  if (!quiet) {
    $('find-error').hidden = true;
    $('track').disabled = true;
  }
  try {
    let res;
    try {
      res = await fetch(`/book-api/parcels/${encodeURIComponent(code)}`);
    } catch {
      throw new Error('No internet connection. Check your data and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || 'Something went wrong. Please try again.');
    render(data);
    history.replaceState(null, '', `/parcels.html?code=${encodeURIComponent(data.tracking_code)}`);
    // Keep it fresh while it is still moving.
    if (['received', 'on_the_way'].includes(data.status)) timer = setTimeout(() => track(code, { quiet: true }), 30_000);
  } catch (err) {
    if (quiet) return;
    $('result').hidden = true;
    $('find-error').textContent = err.message;
    $('find-error').hidden = false;
  } finally {
    $('track').disabled = false;
  }
}

$('find').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim().toUpperCase();
  if (code) track(code);
});
const fromLink = new URLSearchParams(location.search).get('code');
if (fromLink) {
  $('code').value = fromLink.toUpperCase();
  track(fromLink.toUpperCase());
}
