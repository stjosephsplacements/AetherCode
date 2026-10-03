SET ROLE aether_user_owner;

REVOKE EXECUTE ON FUNCTION users.enroll_student_with_affiliations(
    uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid
) FROM aether_user_app;
DROP FUNCTION users.enroll_student_with_affiliations(
    uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid
);

REVOKE SELECT, INSERT, UPDATE, DELETE ON users.tenant_department_projections, users.tenant_batch_projections,
    users.tenant_projection_inbox_messages
    FROM aether_user_projection_worker;
REVOKE SELECT ON users.tenant_department_projections, users.tenant_batch_projections
    FROM aether_user_app;
DROP TABLE users.tenant_batch_projections;
DROP TABLE users.tenant_department_projections;
DROP TABLE users.tenant_projection_inbox_messages;

RESET ROLE;
