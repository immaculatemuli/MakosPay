-- Where each car is, from its driver's (or conductor's) phone while it is on a trip: only the latest position is
-- kept, shown on a map to the passengers it is picking and to the marshals.
CREATE TABLE vehicle_locations (
  vehicle_id  INTEGER PRIMARY KEY REFERENCES vehicles(id),
  lat         DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading     DOUBLE PRECISION,
  speed       DOUBLE PRECISION,
  accuracy    DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
