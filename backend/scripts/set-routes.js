// Sets the SACCO's routes to the list below: adds or updates each one (one fixed fare per route, stops in order),
// and switches off every other route (kept for past trips; the office can switch one back on). Usage:
//   yarn set-routes            shows what would change
//   yarn set-routes --apply    changes it
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { closeDatabase, db, isPostgres } from '../src/database.js';
import { createRoute, getRoute, updateRoute } from '../src/services/routes.js';

const ROUTES = [
  { name: 'Nairobi - Machakos', origin: 'Nairobi', fare: 250, stops: ['Mlolongo', 'Athi River', 'Kyumbi', 'Machakos'] },
  { name: 'Nairobi - Wote', origin: 'Nairobi', fare: 500, stops: ['Mlolongo', 'Athi River', 'Machakos', 'Kola', 'Wote'] },
  { name: 'Nairobi - Kikima', origin: 'Nairobi', fare: 400, stops: ['Mlolongo', 'Athi River', 'Machakos', 'Tawa', 'Kikima'] },
  { name: 'Nairobi - Kitui', origin: 'Nairobi', fare: 600, stops: ['Mlolongo', 'Athi River', 'Machakos', 'Masii', 'Kitui'] },
  // The way back: the conductor switches the car to one of these (Change route) before it loads for Nairobi.
  { name: 'Machakos - Nairobi', origin: 'Machakos', fare: 250, stops: ['Kyumbi', 'Athi River', 'Mlolongo', 'Nairobi'] },
  { name: 'Wote - Nairobi', origin: 'Wote', fare: 500, stops: ['Kola', 'Machakos', 'Athi River', 'Mlolongo', 'Nairobi'] },
  { name: 'Kikima - Nairobi', origin: 'Kikima', fare: 400, stops: ['Tawa', 'Machakos', 'Athi River', 'Mlolongo', 'Nairobi'] },
  { name: 'Kitui - Nairobi', origin: 'Kitui', fare: 600, stops: ['Masii', 'Machakos', 'Athi River', 'Mlolongo', 'Nairobi'] },
];

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
const where = isPostgres ? 'the PostgreSQL database (DATABASE_URL)' : config.dbPath;

try {
  const admin = await db.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const existing = await db.all('SELECT id, name, is_active FROM routes ORDER BY id');
  const byName = new Map(existing.map((r) => [r.name.toLowerCase(), r]));
  console.log(`${values.apply ? 'Changing' : 'Would change (add --apply to do it)'} ${where}:`);

  for (const r of ROUTES) {
    const found = byName.get(r.name.toLowerCase());
    console.log(`  ${found ? 'update' : 'add   '} ${r.name}: KES ${r.fare}, ${r.origin} → ${r.stops.join(', ')}`);
    if (!values.apply) continue;
    if (found) {
      // Keep the ids of stops with the same name, so past trips and saved stops stay linked.
      const old = (await getRoute(found.id)).stops;
      const stops = r.stops.map((name) => ({ ...(old.find((s) => s.name.toLowerCase() === name.toLowerCase()) && { id: old.find((s) => s.name.toLowerCase() === name.toLowerCase()).id }), name }));
      await updateRoute(found.id, { name: r.name, origin: r.origin, is_active: true, fare: r.fare, stops }, admin.id);
    } else {
      await createRoute({ name: r.name, origin: r.origin, fare: r.fare, stops: r.stops.map((name) => ({ name })) });
    }
  }

  // Cars on a route being switched off move to the first route, so they can still take fares (the office then
  // gives each its real route). A car loading or on the road keeps its route until its trip is over.
  const keep = new Set(ROUTES.map((r) => r.name.toLowerCase()));
  const first = values.apply ? await db.get('SELECT id FROM routes WHERE LOWER(name) = ?', ROUTES[0].name.toLowerCase()) : null;
  for (const r of existing.filter((x) => x.is_active && !keep.has(x.name.toLowerCase()))) {
    console.log(`  switch off ${r.name}`);
    for (const car of await db.all('SELECT id, plate FROM vehicles WHERE route_id = ? AND is_active = TRUE', r.id)) {
      const busy = await db.get("SELECT 1 FROM loads WHERE vehicle_id = ? AND (status = 'loading' OR finished_at IS NULL)", car.id);
      console.log(busy ? `    ${car.plate} is loading or on a trip: left on ${r.name}; move it later` : `    move ${car.plate} to ${ROUTES[0].name}`);
      if (values.apply && !busy) await db.run('UPDATE vehicles SET route_id = ? WHERE id = ?', first.id, car.id);
    }
    if (values.apply) await db.run('UPDATE routes SET is_active = FALSE WHERE id = ?', r.id);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
