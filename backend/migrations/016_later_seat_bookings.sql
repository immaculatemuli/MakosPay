-- Seats booked for later (today or tomorrow): the passenger says when they will be at the stage or pickup point
-- ("ready from"). The booking joins the queue at that time (queued_at = ready_at), so it is offered to no car before
-- then, and is ahead of anyone who chose a later time. NULL = ready now.
ALTER TABLE seat_bookings ADD COLUMN ready_at TIMESTAMPTZ;
-- When the passenger was reminded that their time is near, and when the marshals were told it joined the queue
-- (each sent once).
ALTER TABLE seat_bookings ADD COLUMN reminded_at TIMESTAMPTZ;
ALTER TABLE seat_bookings ADD COLUMN marshals_told_at TIMESTAMPTZ;
