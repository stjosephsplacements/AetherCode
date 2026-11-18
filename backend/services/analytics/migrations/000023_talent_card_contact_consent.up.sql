-- A card is signed once, so the contact details inside it outlive the student's choice. Verification asks
-- this function and drops email and phone from the claims when the student has since stopped sharing them
-- (withdrawing consent altogether already revokes the card).
SET ROLE aether_analytics_owner;

CREATE FUNCTION analytics.talent_card_shares_contact(p_card_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, analytics
AS $function$
    SELECT COALESCE((
        SELECT consent.granted AND consent.share_contact_info
        FROM analytics.talent_cards AS card
        JOIN analytics.talent_card_consents AS consent
          ON consent.tenant_id = card.tenant_id AND consent.student_id = card.student_id
        WHERE card.id = p_card_id
    ), false)
$function$;

REVOKE ALL ON FUNCTION analytics.talent_card_shares_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.talent_card_shares_contact(uuid) TO aether_analytics_app;

RESET ROLE;
