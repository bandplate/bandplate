-- Push notifications (spec: three per-member toggles, one tick every 10
-- min deciding everything, claim-then-send so a racing tick never
-- double-sends).
--
-- `takes.push_batched_at` marks a published take as folded into a "new
-- takes" push batch: pending means `published_at IS NOT NULL AND
-- push_batched_at IS NULL`. The backfill below sets it to `published_at`
-- for every row that predates this migration, or the first deploy would
-- announce the whole archive as one giant batch. The partial index mirrors
-- that same pending condition so `notificationsRepo.listPendingTakeBatches`
-- scans only the rows that matter, not the whole table.
CREATE TABLE `notification_claims` (
	`key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_prefs` (
	`member_id` text PRIMARY KEY NOT NULL,
	`new_takes` integer DEFAULT true NOT NULL,
	`weekly_unvoted` integer DEFAULT true NOT NULL,
	`song_changes` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`vapid_key_id` text NOT NULL,
	`auth_session_id` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_success_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_member_id_idx` ON `push_subscriptions` (`member_id`);--> statement-breakpoint
CREATE TABLE `song_chart_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `song_chart_changes_song_id_changed_at_idx` ON `song_chart_changes` (`song_id`,`changed_at`);--> statement-breakpoint
ALTER TABLE `songs` ADD `chart_notified_at` integer;--> statement-breakpoint
ALTER TABLE `takes` ADD `push_batched_at` integer;--> statement-breakpoint
UPDATE `takes` SET `push_batched_at` = `published_at` WHERE `published_at` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `takes_push_pending_idx` ON `takes` (`event_id`,`published_at`) WHERE `push_batched_at` IS NULL AND `published_at` IS NOT NULL;