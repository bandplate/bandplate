-- Manual content management (M8): archiving an event is a soft retirement,
-- so its takes are never orphaned. NULL means "not archived", which is what
-- every existing row already means — no backfill.
ALTER TABLE `events` ADD `archived_at` integer;
