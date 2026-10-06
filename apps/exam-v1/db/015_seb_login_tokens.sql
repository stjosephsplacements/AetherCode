-- The tokens no longer gate the config download (the config is the same for
-- everyone); SEB appends them to its Start URL to sign the student in once.
ALTER TABLE seb_download_tokens RENAME TO seb_login_tokens;
DELETE FROM seb_login_tokens;
