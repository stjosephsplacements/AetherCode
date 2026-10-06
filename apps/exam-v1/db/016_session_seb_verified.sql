-- Set once a session proves it runs inside SEB through the SEB JavaScript API
-- (SEB for macOS cannot send the Config Key header with its modern WebView).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS seb_verified boolean NOT NULL DEFAULT false;
