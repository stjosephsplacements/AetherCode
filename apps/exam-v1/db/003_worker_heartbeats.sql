CREATE TABLE worker_heartbeats (
    worker_id text PRIMARY KEY,
    seen_at timestamptz NOT NULL DEFAULT now(),
    in_flight integer NOT NULL DEFAULT 0,
    engine text NOT NULL
);
