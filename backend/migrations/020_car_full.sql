-- "The car is full" (said by the marshal or crew): a loading car stops taking passengers from the queue, e.g. when
-- people paying cash filled it. NULL: seats are counted (bookings and FarePay fares paid on it while loading).
ALTER TABLE loads ADD COLUMN full_at TIMESTAMPTZ;
