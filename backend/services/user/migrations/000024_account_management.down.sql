SET ROLE aether_user_owner;

DROP FUNCTION users.grant_staff_role(uuid, uuid, text, uuid, uuid);
DROP FUNCTION users.batch_account_principals(uuid, uuid);
DROP FUNCTION users.tenant_account_principals(uuid, uuid[]);
DROP FUNCTION users.import_students(uuid, uuid, uuid, uuid, uuid, uuid[], text[]);
DROP FUNCTION users.existing_enrollment_numbers(uuid, uuid, uuid, uuid, text[]);
DROP FUNCTION users.require_student_import_targets(uuid, uuid, uuid, uuid);
DROP FUNCTION users.tenant_only_principals(uuid, uuid[]);

RESET ROLE;
