-- The stash (Šuplík). A take can now be private to one member, and an event can
-- be one member's personal day. Every existing row keeps meaning what it meant:
-- `visibility` defaults to 'band', both owner columns are NULL. No backfill
-- statement needed; `migration-0010-stash.test.ts` proves it on a populated db.
ALTER TABLE `events` ADD `owner_member_id` text;--> statement-breakpoint
ALTER TABLE `takes` ADD `owner_member_id` text;--> statement-breakpoint
ALTER TABLE `takes` ADD `visibility` text DEFAULT 'band' NOT NULL;--> statement-breakpoint
CREATE INDEX `takes_owner_member_id_visibility_recorded_at_idx` ON `takes` (`owner_member_id`,`visibility`,`recorded_at`);