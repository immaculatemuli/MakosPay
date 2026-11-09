-- When the reporter and the SACCO office last looked at each report, to mark new replies ("New reply").
-- Reports from before count as seen, so nothing old shows as new.
ALTER TABLE reports ADD COLUMN reporter_seen_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN office_seen_at TIMESTAMPTZ;
UPDATE reports SET reporter_seen_at = now(), office_seen_at = now();
