ALTER TABLE cart_sessions
  ADD COLUMN IF NOT EXISTS extension_used_at timestamptz;
