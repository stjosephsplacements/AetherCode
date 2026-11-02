SET ROLE aether_question_bank_owner;

DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM qbank.categories GROUP BY normalized_name HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'cannot restore global unique category names: two categories share a name under different parents'
            USING ERRCODE = '55000';
    END IF;
END
$guard$;

-- Restore the functions as migration 000022 left them.
CREATE OR REPLACE FUNCTION qbank.create_category(p_id uuid, p_name text)
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
    INSERT INTO qbank.categories (id, name, normalized_name, created_by)
    VALUES (p_id, cleaned, lower(cleaned), actor_id)
    ON CONFLICT (normalized_name) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    SELECT * INTO found_category FROM qbank.categories WHERE normalized_name = lower(cleaned);
    RETURN jsonb_build_object('id', found_category.id, 'name', found_category.name, 'created', inserted = 1);
END
$function$;

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
            jsonb_build_object('id', category.id, 'name', category.name, 'question_count', COALESCE(counts.total, 0))
            ORDER BY (category.id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid), category.normalized_name
        )
        FROM qbank.categories AS category
        LEFT JOIN LATERAL (
            SELECT count(*)::integer AS total
            FROM qbank.questions AS question
            WHERE question.category_id = category.id AND question.deleted_at IS NULL AND question.lifecycle_state <> 'archived'
        ) AS counts ON true
    ), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION qbank.rename_category(p_category_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    cleaned text;
BEGIN
    PERFORM qbank.require_write_context('qbank.category_management');
    cleaned := btrim(regexp_replace(COALESCE(p_name, ''), '[[:space:]]+', ' ', 'g'));
    IF p_category_id IS NULL OR char_length(cleaned) NOT BETWEEN 1 AND 80 OR cleaned ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'category name must be 1 to 80 characters' USING ERRCODE = '22023';
    END IF;
    IF p_category_id = '018f4b0d-08f8-7c09-9ba7-efdf9c220c01'::uuid THEN
        RAISE EXCEPTION 'category Uncategorised is built in and cannot be renamed' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM qbank.categories WHERE normalized_name = lower(cleaned) AND id <> p_category_id) THEN
        RAISE EXCEPTION 'category name is already in use' USING ERRCODE = '55000';
    END IF;
    UPDATE qbank.categories SET name = cleaned, normalized_name = lower(cleaned) WHERE id = p_category_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('id', p_category_id, 'name', cleaned);
END
$function$;

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
    IF NOT EXISTS (SELECT 1 FROM qbank.categories WHERE id = target) THEN
        RAISE EXCEPTION 'category to move questions into was not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE qbank.questions SET category_id = target WHERE category_id = p_category_id;
    GET DIAGNOSTICS moved = ROW_COUNT;
    DELETE FROM qbank.categories WHERE id = p_category_id;
    RETURN jsonb_build_object('deleted', p_category_id, 'moved_to', target, 'moved', moved);
END
$function$;

DROP FUNCTION qbank.move_category(uuid, uuid);
DROP FUNCTION qbank.create_category(uuid, text, uuid);
DROP TRIGGER categories_depth ON qbank.categories;
DROP FUNCTION qbank.check_category_depth();
DROP INDEX qbank.categories_parent_idx;
DROP INDEX qbank.categories_sibling_name_key;
ALTER TABLE qbank.categories ADD CONSTRAINT categories_normalized_name_key UNIQUE (normalized_name);
ALTER TABLE qbank.categories DROP COLUMN parent_id;

RESET ROLE;
