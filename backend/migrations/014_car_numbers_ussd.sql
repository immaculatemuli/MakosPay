-- USSD: passengers without the app or a smartphone pay and book by dialling the SACCO's code.
-- A short car number (e.g. 214), printed on the sticker beside the QR code, is how they say which car they are in:
-- quick to type on a keypad, unlike a plate. Numbers start at 101 and are never reused.
ALTER TABLE vehicles ADD COLUMN car_number INTEGER;
UPDATE vehicles SET car_number = 100 + n.rn FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM vehicles) n WHERE n.id = vehicles.id;
CREATE UNIQUE INDEX idx_vehicles_car_number ON vehicles (car_number);

-- Where a payment was started: 'ussd' ones also get their ticket by SMS (a USSD screen can't show it).
ALTER TABLE mpesa_payments ADD COLUMN channel TEXT CHECK (channel IN ('ussd'));
