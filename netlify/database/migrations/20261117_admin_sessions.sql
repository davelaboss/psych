-- Development only. Existing OWNER credential and REVIEWER architecture stay intact.
CREATE TABLE admin_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  credential_binding text NOT NULL,
  role text NOT NULL CHECK (role = 'OWNER'),
  remember_me boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at) WHERE revoked_at IS NULL;
