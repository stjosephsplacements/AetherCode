SET ROLE aether_submission_owner;

DROP FUNCTION submission.get_attempt_result_for_candidate(uuid, uuid);
DROP FUNCTION submission.get_attempt_live_state_for_candidate(uuid, uuid);
DROP FUNCTION submission.post_exam_announcement(uuid, uuid, uuid, text);
DROP FUNCTION submission.extend_attempt_deadlines(uuid, uuid, uuid, integer);
DROP FUNCTION submission.set_exam_results_release(uuid, uuid, boolean);
DROP FUNCTION submission.get_exam_monitor(uuid, uuid);
DROP FUNCTION submission.attempt_item_scores(uuid, uuid);
DROP TABLE submission.exam_announcements;
DROP TABLE submission.exam_operations;

RESET ROLE;
