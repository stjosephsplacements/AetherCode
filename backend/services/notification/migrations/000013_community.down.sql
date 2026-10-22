SET ROLE aether_notification_owner;

DROP FUNCTION notification.community_task_delete(uuid, jsonb);
DROP FUNCTION notification.community_task_update(uuid, jsonb);
DROP FUNCTION notification.community_task_create(uuid, jsonb);
DROP FUNCTION notification.community_tasks_list(uuid, jsonb);
DROP FUNCTION notification.community_task_json(notification.community_tasks);
DROP FUNCTION notification.community_link_set(uuid, jsonb);
DROP FUNCTION notification.community_links_get(uuid, jsonb);
DROP FUNCTION notification.community_bookmark_set(uuid, jsonb);
DROP FUNCTION notification.community_feed_delete(uuid, jsonb);
DROP FUNCTION notification.community_feed_save(uuid, jsonb);
DROP FUNCTION notification.community_feed_list(uuid, jsonb);
DROP FUNCTION notification.community_feed_json(notification.community_feed_items, boolean);
DROP FUNCTION notification.community_post_delete(uuid, jsonb);
DROP FUNCTION notification.community_post_save(uuid, jsonb);
DROP FUNCTION notification.community_posts_manage(uuid, jsonb);
DROP FUNCTION notification.community_post_get(uuid, jsonb);
DROP FUNCTION notification.community_posts_list(uuid, jsonb);
DROP FUNCTION notification.community_post_json(notification.community_posts, boolean);
DROP FUNCTION notification.community_experience_review(uuid, jsonb);
DROP FUNCTION notification.community_experience_queue(uuid, jsonb);
DROP FUNCTION notification.community_experience_delete_own(uuid, jsonb);
DROP FUNCTION notification.community_experience_list(uuid, jsonb);
DROP FUNCTION notification.community_experience_submit(uuid, jsonb);
DROP FUNCTION notification.community_experience_json(notification.community_experiences, uuid, boolean);
DROP FUNCTION notification.community_limit(jsonb);
DROP FUNCTION notification.community_tags(jsonb);
DROP FUNCTION notification.community_text(jsonb, text, integer, integer);
DROP FUNCTION notification.community_actor(uuid, text, boolean);

DROP TABLE notification.community_tasks;
DROP TABLE notification.community_profile_links;
DROP TABLE notification.community_bookmarks;
DROP TABLE notification.community_feed_items;
DROP TABLE notification.community_posts;
DROP TABLE notification.community_experiences;

RESET ROLE;
