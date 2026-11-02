-- Refunds and withdrawals to M-Pesa that could not reach Safaricom at all (no connection: nothing was sent) are tried
-- again automatically: how many times so far, and when next. NULL next_try_at = not waiting for a retry.
ALTER TABLE withdrawals ADD COLUMN send_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE withdrawals ADD COLUMN next_try_at TIMESTAMPTZ;
