SET ROLE aether_assessment_owner;

REVOKE EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text
) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid, uuid)
    FROM aether_assessment_app;
DROP FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid, uuid);
DROP FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text
);

GRANT EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text
) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid)
    TO aether_assessment_app;

ALTER TABLE assessment.exam_items DROP COLUMN evaluation_bundle_object_key;
ALTER TABLE assessment.exam_versions DROP COLUMN attempt_limit;

RESET ROLE;
