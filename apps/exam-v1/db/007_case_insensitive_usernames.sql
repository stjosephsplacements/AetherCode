-- Sign-in matches usernames case-insensitively, so they must be unique that way.
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));
