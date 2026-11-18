SET ROLE aether_seb_owner;

DROP FUNCTION seb.consume_launch_ticket(uuid, uuid, bytea);
DROP FUNCTION seb.issue_launch_ticket(uuid, uuid, bytea);
DROP TABLE seb.launch_tickets;

RESET ROLE;
