-- Wake the worker instantly when a submission is queued, and push the verdict
-- to SSE clients when grading finishes.  Both use pg_notify which is
-- essentially free (no disk I/O, payload is just the UUID).

CREATE OR REPLACE FUNCTION notify_submission_queued() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('submission_queued', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submission_queued_trigger
  AFTER INSERT ON submissions
  FOR EACH ROW WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION notify_submission_queued();

CREATE OR REPLACE FUNCTION notify_submission_done() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('done', 'error') AND OLD.status IN ('queued', 'running') THEN
    PERFORM pg_notify('submission_done', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submission_done_trigger
  AFTER UPDATE ON submissions
  FOR EACH ROW
  EXECUTE FUNCTION notify_submission_done();
