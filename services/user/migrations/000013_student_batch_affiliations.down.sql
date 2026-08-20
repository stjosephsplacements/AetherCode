SET ROLE aether_user_owner;

DELETE FROM users.authorization_policy_rules
WHERE id IN (
    '018f4b0d-08f8-7c09-9ba7-efdf9c220017',
    '018f4b0d-08f8-7c09-9ba7-efdf9c220018'
);

REVOKE EXECUTE ON FUNCTION users.set_student_batch_affiliation(uuid, uuid, uuid, uuid, integer)
    FROM aether_user_app;
REVOKE EXECUTE ON FUNCTION users.end_student_batch_affiliation(uuid, uuid, integer)
    FROM aether_user_app;
REVOKE EXECUTE ON FUNCTION users.get_student_batch_affiliation(uuid, uuid)
    FROM aether_user_app;
DROP FUNCTION users.set_student_batch_affiliation(uuid, uuid, uuid, uuid, integer);
DROP FUNCTION users.end_student_batch_affiliation(uuid, uuid, integer);
DROP FUNCTION users.get_student_batch_affiliation(uuid, uuid);

DROP TRIGGER students_create_initial_batch_affiliation ON users.students;
DROP TRIGGER current_student_batch_affiliations_protect_delete ON users.current_student_batch_affiliations;
DROP TRIGGER current_student_batch_affiliations_reject_tenant_move ON users.current_student_batch_affiliations;
DROP TRIGGER current_student_batch_affiliations_touch_updated_at ON users.current_student_batch_affiliations;
DROP TRIGGER current_student_batch_affiliations_validate ON users.current_student_batch_affiliations;
DROP TRIGGER student_batch_memberships_reject_tenant_move ON users.student_batch_memberships;
DROP TRIGGER student_batch_memberships_touch_updated_at ON users.student_batch_memberships;
DROP TRIGGER student_batch_memberships_protect_history ON users.student_batch_memberships;

DROP FUNCTION users.create_initial_student_batch_affiliation();
DROP FUNCTION users.protect_current_student_batch_affiliation();
DROP FUNCTION users.validate_current_student_batch_affiliation();
DROP FUNCTION users.protect_student_batch_membership_history();

DROP TABLE users.current_student_batch_affiliations;
DROP TABLE users.student_batch_memberships;

RESET ROLE;
