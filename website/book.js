// Book a seat on the next Makos car loading at the stage. Everything shown comes from FarePay as plain text
// (textContent, never HTML). A booking is kept as its link (/book.html?b=<token>) and remembered on this phone.
'use strict';

const $ = (id) => document.getElementById(id);
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;
const PANELS = ['loading', 'problem', 'routes', 'details', 'paying', 'booking'];
const show = (...names) => PANELS.forEach((p) => ($(p).hidden = !names.includes(p)));

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
      // private browsing: works, just doesn't remember
    }
  },
};

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('No internet connection. Check your data and try again.'), { network: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || 'Something went wrong. Please try again.'), { code: data.error?.code, details: data.error?.details });
  return data;
}

const normalPhone = (text) => {
  const m = text.replace(/[\s-]/g, '').match(/^(?:\+?254|0)?([17]\d{8})$/);
  return m ? `0${m[1]}` : null;
};
const spaced = (phone) => phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const newKey = () =>
  crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

let routes = [];
let route = null; // the chosen route
let stopId = null;
let seats = 1;
let pollTimer = null;
let token = null; // the booking being shown

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- 1. Route ----------

function carText(r) {
  if (r.next_car) return `${r.next_car.plate} loading · ${r.next_car.seats_left} seat${r.next_car.seats_left === 1 ? '' : 's'} left`;
  if (r.cars_loading > 0) return 'Cars loading are full · next car soon';
  return 'No car loading yet';
}

function renderRoutes() {
  const list = $('route-list');
  list.replaceChildren();
  if (routes.length === 0) list.append(el('p', 'muted', 'No routes are open for booking yet.'));
  for (const r of routes) {
    const b = el('button', 'option');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(route?.id === r.id));
    const left = el('span');
    left.append(el('span', 'title', r.name), el('span', 'sub', `From ${r.origin}`));
    const right = el('span', `right ${r.next_car ? 'seats-ok' : 'muted'}`, carText(r));
    b.append(left, right);
    b.addEventListener('click', () => chooseRoute(r.id));
    list.append(b);
  }
}

async function loadRoutes() {
  routes = await call('GET', '/book-api/routes');
  if (route) route = routes.find((r) => r.id === route.id) ?? null;
}

function chooseRoute(id) {
  route = routes.find((r) => r.id === id);
  remember.set('book.route', id);
  const last = remember.get(`book.stop.${id}`);
  stopId = route.stops.some((s) => s.id === last) ? last : route.stops.length === 1 ? route.stops[0].id : null;
  seats = Math.min(seats, maxSeats());
  renderRoutes();
  renderDetails();
  show('routes', 'details');
  $('details').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 2. Stop, seats, number ----------

// Up to 10 seats in one booking, and no more than the car loading has left.
const maxSeats = () => Math.max(1, Math.min(10, route?.next_car?.seats_left ?? 10));

function renderDetails() {
  $('details-car').textContent = route.next_car
    ? `Booking on ${route.next_car.plate}, loading now at ${route.origin}.`
    : `No car on ${route.name} is taking bookings right now. You can book as soon as one starts loading.`;
  const stops = $('stops');
  stops.replaceChildren();
  for (const s of route.stops) {
    const b = el('button', 'option');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(s.id === stopId));
    b.append(el('span', 'title', s.name), el('span', 'right', kes(s.fare)));
    b.addEventListener('click', () => {
      stopId = s.id;
      renderDetails();
    });
    stops.append(b);
  }
  $('seats').textContent = String(seats);
  $('seats-minus').disabled = seats <= 1;
  $('seats-plus').disabled = seats >= maxSeats();
  if (!$('phone').value) $('phone').value = remember.get('phone') ?? '';
  updateBookButton();
}

function updateBookButton() {
  const stop = route?.stops.find((s) => s.id === stopId);
  const button = $('book');
  button.disabled = !stop || !normalPhone($('phone').value) || !route.next_car;
  button.textContent = !route?.next_car ? 'No car taking bookings yet' : stop ? `Pay ${kes(stop.fare * seats)} with M-Pesa` : 'Choose your stop';
}

async function book() {
  const stop = route.stops.find((s) => s.id === stopId);
  const phone = normalPhone($('phone').value);
  if (!stop || !phone) return;
  $('book-error').hidden = true;
  $('book').disabled = true;
  $('paying-amount').textContent = kes(stop.fare * seats);
  $('paying-what').textContent = `${seats} seat${seats === 1 ? '' : 's'} · ${route.name} to ${stop.name} · prompt sent to ${spaced(phone)}`;
  show('paying');
  try {
    const result = await call('POST', '/book-api/bookings', { route_id: route.id, stop_id: stop.id, seats, expected_fare: stop.fare, phone, idempotency_key: newKey() });
    remember.set('phone', phone);
    remember.set(`book.stop.${route.id}`, stop.id);
    keepBooking(result.booking_token, result);
    openBooking(result.booking_token, result);
  } catch (err) {
    if (['FARE_CHANGED', 'NOT_ENOUGH_SEATS', 'NO_CAR_LOADING'].includes(err.code)) await loadRoutes().catch(() => {});
    renderRoutes();
    renderDetails();
    show('routes', 'details');
    $('book-error').textContent = err.message;
    $('book-error').hidden = false;
  }
}

// ---------- The booking ----------

const STATUS_TEXT = {
  paying: 'Waiting for M-Pesa…',
  confirmed: '✓ Seat booked',
  boarded: '✓ On board',
  departed: 'Car has left',
  cancelled: 'Cancelled',
  failed: 'Not paid',
  paid_late: 'Paid too late',
};

function carLine(b) {
  if (b.status === 'paying') return 'Enter your M-Pesa PIN on your phone to finish booking.';
  if (b.status === 'failed') return `${b.reason || 'M-Pesa did not complete the payment'}. No money was taken, and no seat is held.`;
  if (b.status === 'paid_late') return 'M-Pesa confirmed your payment too late for this car, so it is kept as FarePay credit. Sign up in the FarePay app with this number to use it, or ask the office.';
  if (b.status === 'cancelled') return 'This booking was cancelled and the money returned to your FarePay wallet.';
  if (b.status === 'boarded') return 'Enjoy your trip.';
  if (b.car.status === 'departed' || b.status === 'departed') return 'This car has left the stage.';
  if (b.car.cars_ahead > 0) return `Your car is loading at ${b.route.origin}. ${b.car.cars_ahead} car${b.car.cars_ahead === 1 ? '' : 's'} ahead of it will leave first.`;
  return `Your car is loading at ${b.route.origin} now. Go to the stage and show this code to the conductor.`;
}

function renderBooking(b) {
  $('b-status').textContent = STATUS_TEXT[b.status] ?? b.status;
  $('b-code').textContent = b.code;
  $('b-plate').textContent = b.car.plate;
  $('b-trip').textContent = `${b.route.name} to ${b.stop_name} · ${b.seats} seat${b.seats === 1 ? '' : 's'} · ${kes(b.amount)}`;
  $('b-paid').textContent = `Booked ${new Date(b.booked_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })}`;
  $('b-car').textContent = carLine(b);
  $('cancel').hidden = !b.can_cancel;
  show('booking');
}

function openBooking(t, state) {
  token = t;
  clearTimeout(pollTimer);
  history.replaceState(null, '', `/book.html?b=${encodeURIComponent(t)}`);
  const step = async () => {
    try {
      const b = await call('GET', `/book-api/bookings/${encodeURIComponent(t)}`);
      if (token !== t) return;
      renderBooking(b);
      // Keep it fresh while something can still change.
      if (['paying', 'confirmed'].includes(b.status)) pollTimer = setTimeout(step, b.status === 'paying' ? 3000 : 15000);
    } catch (err) {
      if (err.network) pollTimer = setTimeout(step, 8000);
      else {
        $('b-error').textContent = err.message;
        $('b-error').hidden = false;
      }
    }
  };
  if (state) {
    renderBooking(state);
    if (['paying', 'confirmed'].includes(state.status)) pollTimer = setTimeout(step, state.status === 'paying' ? 3000 : 15000);
  } else step();
}

// This phone's bookings (newest first, last 5), to come back to.
function keepBooking(t, b) {
  const list = (remember.get('bookings') ?? []).filter((x) => x.token !== t);
  list.unshift({ token: t, code: b.code, plate: b.car.plate, route: b.route.name, at: Date.now() });
  remember.set('bookings', list.slice(0, 5));
  renderMine();
}

function renderMine() {
  const list = (remember.get('bookings') ?? []).filter((x) => Date.now() - x.at < 3 * 86_400_000);
  $('mine').hidden = list.length === 0;
  const box = $('mine-list');
  box.replaceChildren();
  for (const x of list) {
    const b = el('button', 'option');
    b.type = 'button';
    b.append(el('span', 'title', `${x.code} · ${x.plate}`), el('span', 'right muted', x.route));
    b.addEventListener('click', () => {
      $('b-error').hidden = true;
      openBooking(x.token);
    });
    box.append(b);
  }
}

async function cancel() {
  if (!token || !window.confirm('Cancel this booking? The money goes back to your FarePay wallet.')) return;
  $('cancel').disabled = true;
  try {
    renderBooking(await call('POST', `/book-api/bookings/${encodeURIComponent(token)}/cancel`));
  } catch (err) {
    $('b-error').textContent = err.message;
    $('b-error').hidden = false;
  } finally {
    $('cancel').disabled = false;
  }
}

async function startOver() {
  clearTimeout(pollTimer);
  token = null;
  history.replaceState(null, '', '/book.html');
  $('b-error').hidden = true;
  show('loading');
  try {
    await loadRoutes();
    renderRoutes();
    if (route) {
      renderDetails();
      show('routes', 'details');
    } else show('routes');
  } catch (err) {
    $('problem-text').textContent = err.message;
    show('problem');
  }
}

async function start() {
  renderMine();
  const t = new URLSearchParams(location.search).get('b');
  if (t) return openBooking(t);
  try {
    await loadRoutes();
  } catch (err) {
    $('problem-text').textContent = err.message;
    return show('problem');
  }
  const last = remember.get('book.route');
  renderRoutes();
  if (routes.some((r) => r.id === last)) chooseRoute(last);
  else show('routes');
}

$('phone').addEventListener('input', updateBookButton);
$('seats-minus').addEventListener('click', () => {
  seats = Math.max(1, seats - 1);
  renderDetails();
});
$('seats-plus').addEventListener('click', () => {
  seats = Math.min(maxSeats(), seats + 1);
  renderDetails();
});
$('book').addEventListener('click', book);
$('refresh').addEventListener('click', startOver);
$('problem-retry').addEventListener('click', startOver);
$('cancel').addEventListener('click', cancel);
$('again').addEventListener('click', startOver);
start();
