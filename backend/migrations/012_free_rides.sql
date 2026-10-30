-- Loyalty: every 50th paid ride (in the last 90 days) is free for the passenger. The car's owner is still paid the
-- full fare: the SACCO covers it, recorded as a free_ride credit to the passenger's wallet that the fare then uses.
ALTER TABLE trips ADD COLUMN free_ride BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE seat_bookings ADD COLUMN free_ride BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_trips_passenger_paid ON trips (passenger_id, created_at) WHERE status = 'paid';

ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('topup', 'fare', 'refund', 'test_credit', 'withdrawal', 'withdrawal_reversal', 'booking_hold', 'booking_release',
                  'free_ride', 'free_ride_reversal'));
