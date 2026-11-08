SET ROLE aether_user_owner;

-- Revert: make placement_membership_id NOT NULL again and restore strict validation.
-- Note: this will fail if any rows have NULL placement_membership_id.

ALTER TABLE users.current_student_affiliations
    ALTER COLUMN placement_membership_id SET NOT NULL;

RESET ROLE;
