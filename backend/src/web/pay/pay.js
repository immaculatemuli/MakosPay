// The pay page for passengers without the app. Opened by the phone's camera from the QR sticker (/pay?v=...).
// Everything shown comes from FarePay as plain text (textContent), never as HTML.
'use strict';

const $ = (id) => document.getElementById(id);
const qr = new URLSearchParams(location.search).get('v');

// Remembered on this phone only, so the next fare is: pick the stop (often already picked), tap Pay.
const remember = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(`farepay.${key}`));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`farepay.${key}`, JSON.stringify(value));
    } catch {
      // private browsing: the page still works, it just doesn't remember
    }
  },
};

const SECTIONS = ['loading', 'problem', 'choose', 'quick', 'waiting', 'paid', 'failed'];
const show = (name) => SECTIONS.forEach((s) => ($(s).hidden = s !== name));
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('No internet connection. Check your data and try again.'), { network: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || 'Something went wrong. Please try again.'), { code: data.error?.code });
  return data;
}

let page = null; // the vehicle and route, from FarePay
let chosenStop = null;
let pollTimer = null;
let countdownTimer = null;

const QUICK_SECONDS = 3;
const spaced = (phone) => phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');

const normalPhone = (text) => {
  const digits = text.replace(/[\s-]/g, '');
  const m = digits.match(/^(?:\+?254|0)?([17]\d{8})$/);
  return m ? `0${m[1]}` : null;
};

function updatePayButton() {
  const stop = page?.route.stops.find((s) => s.id === chosenStop);
  const button = $('pay');
  button.disabled = !stop || !normalPhone($('phone').value);
  button.textContent = stop ? `Pay ${kes(stop.fare)} with M-Pesa` : 'Choose your stop';
}

function chooseStop(id) {
  chosenStop = id;
  for (const el of $('stops').children) el.setAttribute('aria-checked', String(Number(el.dataset.id) === id));
  updatePayButton();
}

/**
 * Quick pay: this phone has paid before and the stop is known (the only stop, or the one it paid to last time on
 * this route), so the M-Pesa prompt goes out by itself after a short countdown. Entering the PIN is the
 * passenger's confirmation; "Change" stops it.
 */
function startQuickPay(stop, phone) {
  $('q-plate').textContent = page.vehicle.plate;
  $('q-route').textContent = page.route.name;
  $('q-amount').textContent = kes(stop.fare);
  $('q-stop').textContent = stop.name;
  $('q-phone').textContent = spaced(phone);
  show('quick');
  let left = QUICK_SECONDS;
  $('q-count').textContent = String(left);
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    left -= 1;
    $('q-count').textContent = String(Math.max(left, 0));
    if (left <= 0) {
      clearInterval(countdownTimer);
      pay();
    }
  }, 1000);
}

function stopQuickPay() {
  clearInterval(countdownTimer);
}

function renderChoose({ quick = false } = {}) {
  $('sacco').textContent = page.sacco_name;
  $('plate').textContent = page.vehicle.plate;
  $('route').textContent = `${page.route.name}${page.vehicle.description ? ` · ${page.vehicle.description}` : ''}`;
  const stops = $('stops');
  stops.replaceChildren();
  for (const stop of page.route.stops) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'stop';
    el.setAttribute('role', 'radio');
    el.dataset.id = String(stop.id);
    const name = document.createElement('span');
    name.textContent = stop.name;
    const fare = document.createElement('span');
    fare.className = 'fare';
    fare.textContent = kes(stop.fare);
    el.append(name, fare);
    el.addEventListener('click', () => chooseStop(stop.id));
    stops.append(el);
  }
  // The stop this phone paid to last time on this route, or the only stop.
  const last = remember.get(`stop.${page.route.id}`);
  const preselect = page.route.stops.find((s) => s.id === last) ?? (page.route.stops.length === 1 ? page.route.stops[0] : null);
  chosenStop = null;
  if (preselect) chooseStop(preselect.id);
  if (!$('phone').value) $('phone').value = remember.get('phone') ?? '';
  $('choose-error').hidden = true;
  updatePayButton();
  const phone = normalPhone($('phone').value);
  if (quick && preselect && phone) return startQuickPay(preselect, phone);
  show('choose');
}

async function loadVehicle() {
  page = await call('GET', `/pay-api/vehicle?qr=${encodeURIComponent(qr)}`);
}

function newKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pay() {
  const stop = page.route.stops.find((s) => s.id === chosenStop);
  const phone = normalPhone($('phone').value);
  if (!stop || !phone) return;
  const button = $('pay');
  button.disabled = true;
  button.textContent = 'Sending the M-Pesa prompt…';
  $('choose-error').hidden = true;
  try {
    const result = await call('POST', '/pay-api/pay', { qr, stop_id: stop.id, expected_fare: stop.fare, phone, idempotency_key: newKey() });
    remember.set('phone', phone);
    remember.set(`stop.${page.route.id}`, stop.id);
    remember.set('last', { token: result.status_token, qr, at: Date.now() });
    follow(result.status_token, result);
  } catch (err) {
    // Back to the choose screen (never quick pay again on its own) with the reason.
    if (err.code === 'FARE_CHANGED') await loadVehicle().catch(() => {});
    renderChoose();
    $('choose-error').textContent = err.message;
    $('choose-error').hidden = false;
    updatePayButton();
  }
}

function showTicket(ticket) {
  $('t-code').textContent = ticket.code;
  $('t-plate').textContent = ticket.plate;
  $('t-trip').textContent = `${ticket.route_name} to ${ticket.stop_name} · ${kes(ticket.fare)}${ticket.status === 'refunded' ? ' · REFUNDED' : ''}`;
  $('t-time').textContent = new Date(ticket.paid_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
  show('paid');
}

/** Shows the payment's state, asking FarePay again every few seconds until M-Pesa has answered. */
function follow(token, state) {
  clearTimeout(pollTimer);
  const started = Date.now();
  const render = (s) => {
    if (s.status === 'paid') return showTicket(s.ticket);
    if (s.status === 'paid_late') {
      $('failed-text').textContent = `M-Pesa confirmed your ${kes(s.amount)} too late for a ticket, so it is kept for you as FarePay credit. Sign up in the FarePay app with this number to use it or take it back to M-Pesa, or ask the SACCO office.`;
      return show('failed');
    }
    if (s.status === 'failed') {
      $('failed-text').textContent = `${s.reason || 'M-Pesa did not complete the payment'}. No money was taken.`;
      return show('failed');
    }
    $('waiting-amount').textContent = kes(s.amount);
    // M-Pesa's prompt on the phone expires after about a minute, so only then may the passenger start again
    // (earlier, they could end up entering their PIN for both).
    const slow = Date.now() - started > 90_000;
    $('waiting-note').textContent = slow
      ? 'Still waiting for M-Pesa. If you cancelled the prompt or it never came, try again.'
      : 'Keep this page open. Your ticket appears here as soon as M-Pesa confirms.';
    $('give-up').hidden = !slow;
    show('waiting');
    pollTimer = setTimeout(async () => {
      try {
        render(await call('GET', `/pay-api/payment/${encodeURIComponent(token)}`));
      } catch (err) {
        if (err.network) return render(s); // try again on the next round
        $('failed-text').textContent = err.message;
        show('failed');
      }
    }, Date.now() - started > 120_000 ? 8000 : 3000);
  };
  render(state);
}

async function start() {
  if (!qr) {
    $('problem-text').textContent = 'Scan the FarePay QR sticker inside the vehicle with your phone camera.';
    return show('problem');
  }
  try {
    await loadVehicle();
  } catch (err) {
    $('problem-text').textContent = err.message;
    return show('problem');
  }
  // Opened again soon after paying (e.g. the page was reloaded): show that payment's ticket or progress.
  const last = remember.get('last');
  if (last && last.qr === qr && Date.now() - last.at < 30 * 60_000) {
    try {
      $('sacco').textContent = page.sacco_name;
      return follow(last.token, await call('GET', `/pay-api/payment/${encodeURIComponent(last.token)}`));
    } catch {
      // fall through to a new payment
    }
  }
  renderChoose({ quick: true });
}

$('phone').addEventListener('input', updatePayButton);
$('q-now').addEventListener('click', () => {
  stopQuickPay();
  pay();
});
$('q-change').addEventListener('click', () => {
  stopQuickPay();
  renderChoose();
});
$('pay').addEventListener('click', pay);
const payAgain = () => {
  clearTimeout(pollTimer);
  remember.set('last', null);
  renderChoose();
};
$('again').addEventListener('click', payAgain);
$('retry').addEventListener('click', payAgain);
$('give-up').addEventListener('click', payAgain);
start();
