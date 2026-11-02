-- Sub-categories: one level of nesting under a category (ADR-0058).
--
-- Rolls out without a gap: parent_id is nullable, every old function signature
-- still works and treats a missing parent as top level.
SET ROLE aether_question_bank_owner;

ALTER TABLE qbank.categories
    ADD COLUMN parent_id uuid REFERENCES qbank.categories (id) ON DELETE RESTRICT;

-- A name is unique among its siblings, so two parents may each have "Basics".
ALTER TABLE qbank.categories DROP CONSTRAINT categories_normalized_name_key;
CREATE UNIQUE INDEX categories_sibling_name_key
    ON qbank.categories (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name);
CREATE INDEX categories_parent_idx ON qbank.categories (parent_id) WHERE parent_id IS NOT NULL;

-- Depth is two at most, and Uncategorised stays top level with no children.
CREATE FUNCTION qbank.check_category_depth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $function$
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION 'category cannot be its own parent' USING ERRCODE = '55000';
    END IF;
    IF NEW.id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid OR NEW.parent_id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid THEN
        RAISE EXCEPTION 'category Uncategorised cannot have a parent or sub-categories' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM qbank.categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
        RAISE EXCEPTION 'a sub-category cannot have sub-categories' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM qbank.categories WHERE parent_id = NEW.id) THEN
        RAISE EXCEPTION 'a category with sub-categories cannot become a sub-category' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$function$;

CREATE TRIGGER categories_depth
    BEFORE INSERT OR UPDATE OF parent_id ON qbank.categories
    FOR EACH ROW EXECUTE FUNCTION qbank.check_category_depth();

-- Own question count per category; top-level items add the total with their children.
CREATE OR REPLACE FUNCTION qbank.list_categories()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
BEGIN
    PERFORM qbank.require_read_context('qbank.categories');
    RETURN COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object('id', category.id, 'name', category.name, 'parent_id', category.parent_id,
                               'question_count', COALESCE(counts.total, 0))
            || CASE WHEN category.parent_id IS NULL
                    THEN jsonb_build_object('question_count_total', COALESCE(counts.total, 0) + COALESCE(children.total, 0))
                    ELSE '{}'::jsonb END
            ORDER BY (category.id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid), category.normalized_name
        )
        FROM qbank.categories AS category
        LEFT JOIN LATERAL (
            SELECT count(*)::integer AS total
            FROM qbank.questions AS question
            WHERE question.category_id = category.id AND question.deleted_at IS NULL AND question.lifecycle_state <> 'archived'
        ) AS counts ON true
        LEFT JOIN LATERAL (
            SELECT count(*)::integer AS total
            FROM qbank.questions AS question
            JOIN qbank.categories AS child ON child.id = question.category_id
            WHERE child.parent_id = category.id AND question.deleted_at IS NULL AND question.lifecycle_state <> 'archived'
        ) AS children ON true
    ), '[]'::jsonb);
END
$function$;

-- Adding a name that exists among the same siblings (in any letter case) returns the existing category.
CREATE FUNCTION qbank.create_category(p_id uuid, p_name text, p_parent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    cleaned text;
    inserted integer;
    found_category qbank.categories%ROWTYPE;
BEGIN
    actor_id := qbank.require_write_context('qbank.categories');
    cleaned := btrim(regexp_replace(COALESCE(p_name, ''), '[[:space:]]+', ' ', 'g'));
    IF p_id IS NULL OR char_length(cleaned) NOT BETWEEN 1 AND 80 OR cleaned ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'category name must be 1 to 80 characters' USING ERRCODE = '22023';
    END IF;
    IF p_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM qbank.categories WHERE id = p_parent_id) THEN
        RAISE EXCEPTION 'parent category was not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO qbank.categories (id, name, normalized_name, parent_id, created_by)
    VALUES (p_id, cleaned, lower(cleaned), p_parent_id, actor_id)
    ON CONFLICT (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    SELECT * INTO found_category FROM qbank.categories
    WHERE normalized_name = lower(cleaned) AND parent_id IS NOT DISTINCT FROM p_parent_id;
    RETURN jsonb_build_object('id', found_category.id, 'name', found_category.name,
                              'parent_id', found_category.parent_id, 'created', inserted = 1);
END
$function$;

-- The old signature (rolling pods) files a category at top level.
CREATE OR REPLACE FUNCTION qbank.create_category(p_id uuid, p_name text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
    SELECT qbank.create_category(p_id, p_name, NULL::uuid)
$function$;

CREATE OR REPLACE FUNCTION qbank.rename_category(p_category_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    cleaned text;
    own_parent uuid;
BEGIN
    PERFORM qbank.require_write_context('qbank.category_management');
    cleaned := btrim(regexp_replace(COALESCE(p_name, ''), '[[:space:]]+', ' ', 'g'));
    IF p_category_id IS NULL OR char_length(cleaned) NOT BETWEEN 1 AND 80 OR cleaned ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'category name must be 1 to 80 characters' USING ERRCODE = '22023';
    END IF;
    IF p_category_id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid THEN
        RAISE EXCEPTION 'category Uncategorised is built in and cannot be renamed' USING ERRCODE = '55000';
    END IF;
    SELECT parent_id INTO own_parent FROM qbank.categories WHERE id = p_category_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category was not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM qbank.categories
               WHERE normalized_name = lower(cleaned) AND parent_id IS NOT DISTINCT FROM own_parent AND id <> p_category_id) THEN
        RAISE EXCEPTION 'category name is already in use' USING ERRCODE = '55000';
    END IF;
    UPDATE qbank.categories SET name = cleaned, normalized_name = lower(cleaned) WHERE id = p_category_id;
    RETURN jsonb_build_object('id', p_category_id, 'name', cleaned, 'parent_id', own_parent);
END
$function$;

-- Moves a category under p_parent_id, or to top level when it is null. The trigger enforces the depth rules.
CREATE FUNCTION qbank.move_category(p_category_id uuid, p_parent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    moved qbank.categories%ROWTYPE;
BEGIN
    PERFORM qbank.require_write_context('qbank.category_management');
    IF p_category_id IS NULL THEN
        RAISE EXCEPTION 'category is required' USING ERRCODE = '22023';
    END IF;
    IF p_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM qbank.categories WHERE id = p_parent_id) THEN
        RAISE EXCEPTION 'parent category was not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM qbank.categories AS sibling JOIN qbank.categories AS self ON self.id = p_category_id
               WHERE sibling.normalized_name = self.normalized_name AND sibling.parent_id IS NOT DISTINCT FROM p_parent_id
                 AND sibling.id <> self.id) THEN
        RAISE EXCEPTION 'category name is already in use' USING ERRCODE = '55000';
    END IF;
    UPDATE qbank.categories SET parent_id = p_parent_id WHERE id = p_category_id RETURNING * INTO moved;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('id', moved.id, 'name', moved.name, 'parent_id', moved.parent_id);
END
$function$;

-- Deleting a category still files its questions under p_move_to, or Uncategorised; it is refused while it has sub-categories.
CREATE OR REPLACE FUNCTION qbank.delete_category(p_category_id uuid, p_move_to uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    target uuid := COALESCE(p_move_to, '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid);
    moved integer;
BEGIN
    PERFORM qbank.require_write_context('qbank.category_management');
    IF p_category_id IS NULL THEN
        RAISE EXCEPTION 'category is required' USING ERRCODE = '22023';
    END IF;
    IF p_category_id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid THEN
        RAISE EXCEPTION 'category Uncategorised is built in and cannot be deleted' USING ERRCODE = '55000';
    END IF;
    IF target = p_category_id THEN
        RAISE EXCEPTION 'category cannot be merged into itself' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM qbank.categories WHERE id = p_category_id) THEN
        RAISE EXCEPTION 'category was not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM qbank.categories WHERE parent_id = p_category_id) THEN
        RAISE EXCEPTION 'category has sub-categories; move or delete them first' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM qbank.categories WHERE id = target) THEN
        RAISE EXCEPTION 'category to move questions into was not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE qbank.questions SET category_id = target WHERE category_id = p_category_id;
    GET DIAGNOSTICS moved = ROW_COUNT;
    DELETE FROM qbank.categories WHERE id = p_category_id;
    RETURN jsonb_build_object('deleted', p_category_id, 'moved_to', target, 'moved', moved);
END
$function$;

REVOKE ALL ON FUNCTION qbank.check_category_depth() FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.create_category(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.move_category(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.create_category(uuid, text, uuid) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.move_category(uuid, uuid) TO aether_question_bank_app;

RESET ROLE;
