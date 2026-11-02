-- Passengers in the app can pay for a seat booking from their FarePay wallet: such a booking has no M-Pesa
-- payment, and points straight at the fare (trip) taken from the wallet.
ALTER TABLE bookings ADD COLUMN trip_id INTEGER REFERENCES trips(id);
