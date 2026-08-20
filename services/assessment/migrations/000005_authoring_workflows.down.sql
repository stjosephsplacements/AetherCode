SET ROLE aether_assessment_owner;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    assessment.proctor_policies,
    assessment.proctor_policy_versions,
    assessment.exams,
    assessment.exam_versions,
    assessment.exam_sections,
    assessment.exam_items,
    assessment.assignment_rules,
    assessment.candidate_assignments
TO aether_assessment_app;
GRANT SELECT, INSERT ON assessment.exam_events TO aether_assessment_app;

REVOKE EXECUTE ON FUNCTION authz.current_context_actor_id() FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.create_proctor_policy_version(uuid, uuid, uuid, bigint, jsonb, text) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.publish_proctor_policy_version(uuid, uuid) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.create_exam_version(uuid, uuid, uuid, bigint, text, text, timestamptz, timestamptz, integer, uuid) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.add_exam_section(uuid, uuid, uuid, bigint, integer, text, text, integer) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.add_exam_item(uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.publish_exam_version(uuid, uuid, bigint, uuid) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.create_assignment_rule(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, jsonb) FROM aether_assessment_app;
REVOKE EXECUTE ON FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid) FROM aether_assessment_app;

DROP FUNCTION assessment.materialize_direct_candidate_assignment(uuid, uuid, uuid, uuid);
DROP FUNCTION assessment.create_assignment_rule(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, jsonb);
DROP FUNCTION assessment.publish_exam_version(uuid, uuid, bigint, uuid);
DROP FUNCTION assessment.add_exam_item(uuid, uuid, uuid, uuid, bigint, integer, uuid, uuid, numeric, text);
DROP FUNCTION assessment.add_exam_section(uuid, uuid, uuid, bigint, integer, text, text, integer);
DROP FUNCTION assessment.create_exam_version(uuid, uuid, uuid, bigint, text, text, timestamptz, timestamptz, integer, uuid);
DROP FUNCTION assessment.publish_proctor_policy_version(uuid, uuid);
DROP FUNCTION assessment.create_proctor_policy_version(uuid, uuid, uuid, bigint, jsonb, text);
DROP FUNCTION authz.current_context_actor_id();

ALTER TABLE assessment.exam_versions DROP COLUMN content_version;

RESET ROLE;
