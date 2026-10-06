-- Global key-value settings for platform-wide config (e.g. SEB BEKs).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value)
VALUES ('seb_exam_key', '')
ON CONFLICT (key) DO NOTHING;

-- Computed Config Key stored per exam after first SEB config download.
-- Validated against X-SafeExamBrowser-ConfigKeyHash on every exam page load.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS seb_config_key TEXT NOT NULL DEFAULT '';

-- Short-lived tokens so SEB (which has no cookies) can download the config.
CREATE TABLE IF NOT EXISTS seb_download_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id    UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes',
  used_at    TIMESTAMPTZ
);
ALTER TABLE seb_download_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
