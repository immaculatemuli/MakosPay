// Crew choose the car they work on by scanning its sticker: matatu crews switch cars, cover for each other and work
// relief shifts, and the office shouldn't have to re-link them every time. A conductor takes the car's conductor
// place (a driver its driver place); whoever had it is told, and every move is in the audit log for the office.
import { db, tx } from '../database.js';
import { HttpError } from '../errors.js';
import { parseQr } from '../util.js';
import { audit } from './audit.js';
import { isLoading } from './bookings.js';
import { notify } from './notifications.js';

const COLUMN = { conductor: 'conductor_id', driver: 'driver_id' };
const WORD = { conductor: 'conductor', driver: 'driver' };

export async function claimVehicle(user, qr) {
  const column = COLUMN[user.role];
  if (!column) throw new HttpError(403, 'FORBIDDEN', 'Only conductors and drivers work on a car');
  const car = await db.get('SELECT id, plate, is_active, conductor_id, driver_id FROM vehicles WHERE qr_token = ?', parseQr(qr));
  if (!car || !car.is_active) throw new HttpError(404, 'INVALID_QR', 'This is not the sticker of a FarePay car in use.');
  if (car[column] === user.id) return { plate: car.plate, changed: false };

  const current = await db.get(`SELECT id, plate FROM vehicles WHERE ${column} = ?`, user.id);
  // A car taking stage bookings needs its crew until it leaves.
  if (current && (await isLoading(current.id))) {
    throw new HttpError(409, 'LOADING', `${current.plate} is taking bookings at the stage. Mark it as left before moving to another car.`);
  }
  const replaced = await tx(async () => {
    const now = await db.get(`SELECT ${column} AS crew FROM vehicles WHERE id = ?`, car.id);
    if (current) await db.run(`UPDATE vehicles SET ${column} = NULL WHERE id = ?`, current.id);
    await db.run(`UPDATE vehicles SET ${column} = ? WHERE id = ?`, user.id, car.id);
    return now.crew;
  });

  const word = WORD[user.role];
  if (replaced) {
    await notify([replaced], {
      kind: 'crew.replaced',
      title: `You are no longer on ${car.plate}`,
      body: `${user.name} scanned ${car.plate} and is now its ${word}. If this is a mistake, call the SACCO office.`,
    });
  }
  await audit(user, 'vehicle.crew_scanned_in', 'vehicles', car.id, {
    role: user.role,
    plate: car.plate,
    left_vehicle: current?.plate ?? null,
    replaced_user_id: replaced ?? null,
  });
  return { plate: car.plate, changed: true, left: current?.plate ?? null };
}
