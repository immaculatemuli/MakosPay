// Book a seat from anywhere: pick the route, where to be picked (the stage or a stop on the road), the drop-off and
// the seats, and pay by M-Pesa. The booking joins the queue; its car is shown as soon as one takes it. Everything shown
// comes from FarePay as plain text (textContent, never HTML). A booking is kept as its link (/book.html?s=<token>)
// and remembered on this phone.
'use strict';

const $ = (id) => document.getElementById(id);
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;
const PANELS = ['loading', 'problem', 'closed', 'routes', 'details', 'paying', 'booking'];
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
const localPhone = (p) => (p && p.startsWith('254') ? `0${p.slice(3)}` : p);
const newKey = () =>
  crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const seatWord = (n) => `${n} seat${n === 1 ? '' : 's'}`;
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

const MAX_SEATS = 10;
let routes = [];
let route = null; // the chosen route
let pickupId = null; // null = at the stage
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

function option(checked, title, sub, right, onClick) {
  const b = el('button', 'option');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(checked));
  const left = el('span');
  left.append(el('span', 'title', title));
  if (sub) left.append(el('span', 'sub', sub));
  b.append(left);
  if (right) b.append(el('span', 'right', right));
  b.addEventListener('click', onClick);
  return b;
}

// ---------- 1. Route ----------

function renderRoutes() {
  const list = $('route-list');
  list.replaceChildren();
  if (routes.length === 0) list.append(el('p', 'muted', 'No routes are open for booking yet.'));
  for (const r of routes) {
    const waiting = r.seats_waiting ? `${seatWord(r.seats_waiting)} booked ahead` : 'No queue';
    list.append(option(route?.id === r.id, r.name, `From ${r.origin}`, waiting, () => chooseRoute(r.id)));
  }
}

async function loadRoutes() {
  const data = await call('GET', '/book-api/seat-routes');
  routes = data.routes;
  if (route) route = routes.find((r) => r.id === route.id) ?? null;
  return data;
}

function chooseRoute(id) {
  route = routes.find((r) => r.id === id);
  remember.set('book.route', id);
  const lastStop = remember.get(`book.stop.${id}`);
  const lastPickup = remember.get(`book.pickup.${id}`);
  stopId = route.stops.some((s) => s.id === lastStop) ? lastStop : null;
  pickupId = route.stops.some((s) => s.id === lastPickup) ? lastPickup : null;
  renderRoutes();
  renderDetails();
  show('routes', 'details');
  $('details').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 2. Pickup, drop-off, seats, number ----------

const position = (id) => route.stops.find((s) => s.id === id)?.position ?? 0;

function renderDetails() {
  // Picked at the stage, or at any stop before the last one.
  const pickups = $('pickups');
  pickups.replaceChildren(
    option(pickupId === null, `${route.origin} stage`, 'Wait in the queue at the stage', null, () => {
      pickupId = null;
      renderDetails();
    }),
  );
  for (const s of route.stops.slice(0, -1)) {
    pickups.append(
      option(pickupId === s.id, s.name, 'Picked on the road', null, () => {
        pickupId = s.id;
        if (stopId !== null && position(stopId) <= s.position) stopId = null;
        renderDetails();
      }),
    );
  }
  // Drop-offs after the pickup; the fare is from the stage wherever they are picked.
  const stops = $('stops');
  stops.replaceChildren();
  for (const s of route.stops.filter((x) => pickupId === null || x.position > position(pickupId))) {
    stops.append(
      option(s.id === stopId, s.name, null, kes(s.fare), () => {
        stopId = s.id;
        renderDetails();
      }),
    );
  }
  $('seats').textContent = String(seats);
  $('seats-minus').disabled = seats <= 1;
  $('seats-plus').disabled = seats >= MAX_SEATS;
  if (!$('phone').value) $('phone').value = remember.get('phone') ?? '';
  updateBookButton();
}

function updateBookButton() {
  const stop = route?.stops.find((s) => s.id === stopId);
  $('book').disabled = !stop || !normalPhone($('phone').value);
  $('book').textContent = stop ? `Pay ${kes(stop.fare * seats)} with M-Pesa` : 'Choose your drop-off';
}

async function book() {
  const stop = route.stops.find((s) => s.id === stopId);
  const phone = normalPhone($('phone').value);
  if (!stop || !phone) return;
  const pickup = pickupId === null ? `${route.origin} stage` : route.stops.find((s) => s.id === pickupId).name;
  $('book-error').hidden = true;
  $('book').disabled = true;
  $('paying-amount').textContent = kes(stop.fare * seats);
  $('paying-what').textContent = `${seatWord(seats)} · ${route.name}, ${pickup} to ${stop.name} · prompt sent to ${spaced(phone)}`;
  show('paying');
  try {
    const result = await call('POST', '/book-api/seats', {
      route_id: route.id,
      pickup_stop_id: pickupId,
      stop_id: stop.id,
      seats,
      expected_fare: stop.fare,
      phone,
      idempotency_key: newKey(),
    });
    remember.set('phone', phone);
    remember.set(`book.stop.${route.id}`, stop.id);
    remember.set(`book.pickup.${route.id}`, pickupId);
    keepBooking(result.token, result);
    openBooking(result.token, result);
  } catch (err) {
    if (err.code === 'FARE_CHANGED') await loadRoutes().catch(() => {});
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
  queued: '✓ Seat booked',
  assigned: '✓ Your car is coming',
  boarded: '✓ On board',
  cancelled: 'Cancelled',
  failed: 'Not paid',
};

function line(b) {
  if (b.status === 'paying') return 'Enter your M-Pesa PIN on your phone to finish booking.';
  if (b.status === 'failed') return `${b.reason || 'M-Pesa did not complete the payment'}. No money was taken.`;
  if (b.status === 'cancelled') {
    return `${b.reason ? `${b.reason}. ` : ''}${kes(b.amount)} ${b.refund_to === 'wallet' ? 'is back in your FarePay wallet' : 'is being sent back to your M-Pesa'}.`;
  }
  if (b.status === 'boarded') return `You're on board ${b.car.plate}. Have a good trip to ${b.stop_name}.`;
  if (b.status === 'assigned') {
    if (b.pickup.at_stage) return `Board ${b.car.plate} now at ${b.pickup.name}. Show this code when you get on.`;
    if (b.car.status === 'departed') return `${b.car.plate} has left ${b.route.origin} and is coming to pick you at ${b.pickup.name}. Be ready with this code.`;
    return `${b.car.plate} will pick you at ${b.pickup.name}. We'll update this page when it leaves ${b.route.origin}.`;
  }
  // Queued: waiting for a car.
  if (b.pickup.at_stage) {
    return b.place_in_queue === 0
      ? `You're next in the queue at ${b.pickup.name}. The next car to arrive is yours.`
      : `You're ${ordinal(b.place_in_queue + 1)} in the queue at ${b.pickup.name}. We'll tell you which car to board.`;
  }
  return `Wait at ${b.pickup.name}. We'll tell you which car is coming for you.`;
}

// Something can still change while it is being paid, waiting, or on a car not yet boarded.
const stillMoving = (b) => ['paying', 'queued', 'assigned'].includes(b.status);

function renderBooking(b) {
  $('b-status').textContent = STATUS_TEXT[b.status] ?? b.status;
  $('b-code').textContent = b.code;
  $('b-plate').textContent = b.car ? b.car.plate : '';
  $('b-plate').hidden = !b.car;
  $('b-trip').textContent = `${b.route.name} · ${b.pickup.name} to ${b.stop_name} · ${seatWord(b.seats)} · ${kes(b.amount)}`;
  $('b-paid').textContent = `Booked ${new Date(b.booked_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })}`;
  $('b-line').textContent = line(b);
  // Call the car's crew once a car is given.
  const crew = b.status === 'assigned' ? (b.car.conductor ?? b.car.driver) : null;
  const call = $('b-call');
  call.replaceChildren();
  call.hidden = !crew;
  if (crew) {
    const a = el('a', null, `Call ${b.car.conductor ? 'the conductor' : 'the driver'} (${crew.name}): ${localPhone(crew.phone)}`);
    a.href = `tel:${localPhone(crew.phone)}`;
    call.append(a);
  }
  $('here').hidden = !(stillMoving(b) && b.status !== 'paying') || Boolean(b.passenger_here_at);
  $('cancel').hidden = !b.can_cancel;
  $('cancel').textContent = `Cancel booking (refund to ${b.pay_with === 'wallet' ? 'FarePay wallet' : 'M-Pesa'})`;
  show('booking');
}

function openBooking(t, state) {
  token = t;
  clearTimeout(pollTimer);
  history.replaceState(null, '', `/book.html?s=${encodeURIComponent(t)}`);
  const step = async () => {
    try {
      const b = await call('GET', `/book-api/seats/${encodeURIComponent(t)}`);
      if (token !== t) return;
      renderBooking(b);
      if (stillMoving(b)) pollTimer = setTimeout(step, b.status === 'paying' ? 3000 : 10000);
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
    if (stillMoving(state)) pollTimer = setTimeout(step, state.status === 'paying' ? 3000 : 10000);
  } else step();
}

// This phone's bookings (newest first, last 5), to come back to.
function keepBooking(t, b) {
  const list = (remember.get('seats') ?? []).filter((x) => x.token !== t);
  list.unshift({ token: t, code: b.code, route: b.route.name, pickup: b.pickup.name, at: Date.now() });
  remember.set('seats', list.slice(0, 5));
  renderMine();
}

function renderMine() {
  const list = (remember.get('seats') ?? []).filter((x) => Date.now() - x.at < 2 * 86_400_000);
  $('mine').hidden = list.length === 0;
  const box = $('mine-list');
  box.replaceChildren();
  for (const x of list) {
    const b = el('button', 'option');
    b.type = 'button';
    b.append(el('span', 'title', x.code), el('span', 'right muted', `${x.route} · ${x.pickup}`));
    b.addEventListener('click', () => {
      $('b-error').hidden = true;
      openBooking(x.token);
    });
    box.append(b);
  }
}

async function act(path, button) {
  button.disabled = true;
  $('b-error').hidden = true;
  try {
    renderBooking(await call('POST', `/book-api/seats/${encodeURIComponent(token)}/${path}`));
  } catch (err) {
    $('b-error').textContent = err.message;
    $('b-error').hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function startOver() {
  clearTimeout(pollTimer);
  token = null;
  history.replaceState(null, '', '/book.html');
  $('b-error').hidden = true;
  show('loading');
  await start();
}

async function start() {
  renderMine();
  const t = new URLSearchParams(location.search).get('s');
  if (t) return openBooking(t);
  let data;
  try {
    data = await loadRoutes();
  } catch (err) {
    $('problem-text').textContent = err.message;
    return show('problem');
  }
  if (!data.open) {
    $('closed-text').textContent = `Seat booking is closed for today. It opens again at ${data.opens_at}.`;
    return show('closed');
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
  seats = Math.min(MAX_SEATS, seats + 1);
  renderDetails();
});
$('book').addEventListener('click', book);
$('problem-retry').addEventListener('click', startOver);
$('here').addEventListener('click', () => act('here', $('here')));
$('cancel').addEventListener('click', () => {
  if (window.confirm('Cancel this booking? The money goes back to you.')) act('cancel', $('cancel'));
});
$('again').addEventListener('click', startOver);
start();
