SET ROLE aether_seb_owner;

DROP FUNCTION seb.candidate_exam_launch(uuid, uuid);
DROP FUNCTION seb.check_exam_request(uuid, text, text, text);
DROP FUNCTION seb.locked_exam_keys(uuid, uuid);
DROP FUNCTION seb.apply_candidate_assignment_snapshot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, bigint);
DROP TABLE seb.exam_policies;
DROP FUNCTION seb.valid_exam_keys(text[]);
DROP TABLE seb.candidate_assignments;
REVOKE USAGE ON SCHEMA seb FROM aether_seb_projection_worker;

RESET ROLE;
