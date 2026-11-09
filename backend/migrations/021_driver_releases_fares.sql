-- The owner's FarePay fares wait until the car's driver taps "Send to owner" (not the conductor). Released fares
-- are paid to the owner at once, and by the daily run / the office's "Pay now" if that payment failed.
-- Fares paid before this change count as released, so money already owed is not held back.
ALTER TABLE trips ADD COLUMN released_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN released_by INTEGER REFERENCES users(id);
UPDATE trips SET released_at = created_at;
