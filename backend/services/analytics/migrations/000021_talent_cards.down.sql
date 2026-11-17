SET ROLE aether_analytics_owner;

DROP FUNCTION IF EXISTS analytics.talent_card_is_valid(uuid);
DROP FUNCTION IF EXISTS analytics.revoke_talent_card(uuid, uuid);
DROP FUNCTION IF EXISTS analytics.store_talent_card(uuid, uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS analytics.talent_card_metrics(uuid, uuid);
DROP FUNCTION IF EXISTS analytics.get_talent_card_consent(uuid, uuid);
DROP FUNCTION IF EXISTS analytics.set_talent_card_consent(uuid, uuid, boolean, boolean, boolean);
DROP TABLE IF EXISTS analytics.talent_cards;
DROP TABLE IF EXISTS analytics.talent_card_consents;

RESET ROLE;
