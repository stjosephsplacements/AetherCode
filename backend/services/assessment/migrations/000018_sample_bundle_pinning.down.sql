SET ROLE aether_assessment_owner;

REVOKE EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, text, text
) FROM aether_assessment_app;
DROP FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text, text, text
);

GRANT EXECUTE ON FUNCTION assessment.add_exam_item(
    uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text, text
) TO aether_assessment_app;

ALTER TABLE assessment.exam_items
    DROP CONSTRAINT sample_bundle_pair_complete,
    DROP COLUMN sample_bundle_object_key,
    DROP COLUMN sample_bundle_checksum;

RESET ROLE;
