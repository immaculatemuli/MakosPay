# Switching FarePay from SQLite to PostgreSQL, and back

Written for whoever runs the FarePay server. Commands run in `backend/` (PowerShell on the laptop; the same
`yarn` commands on a Linux server). Daraja stays in sandbox throughout.

## Before you start

- The app works on either database; `DB_ENGINE` in `backend/.env` chooses (`sqlite` or `postgres`).
- **No money may be in flight.** In the app: no M-Pesa top-up waiting, no owner payout or passenger withdrawal
  "processing" or "manual". The copy tool checks this and refuses otherwise.
- Don't switch between 20:45 and 21:30 Kenyan time (the daily owner payout runs at 21:00).

## Switch (about 5 minutes)

1. **Stop the server** (Ctrl+C in its window; on a server `sudo systemctl stop farepay`).
2. **Back up SQLite:** `yarn backup` (writes `data/backups/farepay-YYYY-MM-DD.db`). Also copy
   `data/farepay.db` somewhere safe. This file is **not changed** by anything below.
3. **Note the code version:** `git log -1 --format=%h` (write it down).
4. **Copy everything into PostgreSQL:** `yarn db:copy-from-sqlite`
   - Copies every table with the same ids, in one transaction, then compares every row with SQLite.
   - Any difference, or existing data in PostgreSQL, and it undoes everything and says why.
   - It must end with `Copied and checked, row for row: ...`.
5. **Switch:** in `backend/.env` set `DB_ENGINE=postgres`.
6. **Start the server** (`yarn dev`, or `sudo systemctl start farepay`).
7. **Check, in the app:** the office signs in; Money check shows 8/8 OK with the same totals as before;
   the vehicles, routes, wallets and payments are there; a passenger can scan and pay (sandbox).
   Phones that were signed in stay signed in.

## Roll back to SQLite

**A. The copy (step 4) failed, or the checks in step 7 fail before anyone uses the app:**
1. Stop the server.
2. In `backend/.env` set `DB_ENGINE=sqlite`.
3. Start the server. SQLite is exactly as it was at step 1; nothing is lost.
4. To try again later, empty PostgreSQL first: `psql <DATABASE_URL> -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`
   then repeat from step 4.

**B. PostgreSQL has been in use (people paid, topped up, were paid out) and must be abandoned:**
Anything that happened on PostgreSQL after the switch is **not** in SQLite. Simply switching back would lose it,
and, worse, SQLite would still see those fares as unpaid, so the next 21:00 run would **pay owners twice**.
1. Stop the server and keep it stopped.
2. Back up PostgreSQL: `yarn backup` (with `DB_ENGINE=postgres` still set) - a `.pgdump` archive.
3. Do **not** start on SQLite until the PostgreSQL data has been copied back (a reverse copy tool is not built
   yet; ask for it) or the office has recorded the post-switch payouts by hand in SQLite.
4. Then set `DB_ENGINE=sqlite` and start.

While the SQLite code is still in the app (it is removed only after a trial period), rollback A takes
under a minute. After it is removed, rolling back also means returning to the code version noted in step 3.

## Daily jobs across the switch

The record of when each daily job last ran (`job_runs`) is copied, so PostgreSQL does not repeat a payout,
money check or backup that SQLite already ran today. Each job claims its day inside a transaction, so even two
servers started at once run it only once (tested on both databases).
