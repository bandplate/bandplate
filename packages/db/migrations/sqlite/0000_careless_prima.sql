CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`take_id` text NOT NULL,
	`kind` text NOT NULL,
	`instrument_id` text,
	`tier` text NOT NULL,
	`format` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text,
	`duration_ms` integer,
	`sample_rate` integer,
	`channels` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	`purged_at` integer,
	FOREIGN KEY (`take_id`) REFERENCES `takes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_storage_key_unique` ON `assets` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_slot_idx` ON `assets` (`take_id`,`kind`,coalesce(`instrument_id`, ''),`tier`,`format`);--> statement-breakpoint
CREATE INDEX `assets_take_id_status_idx` ON `assets` (`take_id`,`status`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	`revoked_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_hash_unique` ON `auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_sessions_member_id_idx` ON `auth_sessions` (`member_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`held_at` integer NOT NULL,
	`venue` text,
	`notes` text,
	`client_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_client_ref_unique` ON `events` (`client_ref`);--> statement-breakpoint
CREATE INDEX `events_held_at_idx` ON `events` (`held_at`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`member_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`member_id`, `target_type`, `target_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `favorites_member_id_created_at_idx` ON `favorites` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_slug_unique` ON `instruments` (`slug`);--> statement-breakpoint
CREATE TABLE `login_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`requested_ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_tokens_token_hash_unique` ON `login_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `login_tokens_member_id_idx` ON `login_tokens` (`member_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`slug` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` integer NOT NULL,
	`email_verified_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_slug_unique` ON `members` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE TABLE `service_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_token_hash_unique` ON `service_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `song_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`alias_norm` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `song_aliases_alias_norm_unique` ON `song_aliases` (`alias_norm`);--> statement-breakpoint
CREATE TABLE `song_instrument_notes` (
	`song_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`song_id`, `instrument_id`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `songs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`title_norm` text NOT NULL,
	`slug` text NOT NULL,
	`tempo_bpm` real,
	`musical_key` text,
	`chord_progression` text,
	`lyrics` text,
	`notes` text,
	`is_stub` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `songs_slug_unique` ON `songs` (`slug`);--> statement-breakpoint
CREATE INDEX `songs_title_norm_idx` ON `songs` (`title_norm`);--> statement-breakpoint
CREATE TABLE `take_instruments` (
	`take_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	PRIMARY KEY(`take_id`, `instrument_id`),
	FOREIGN KEY (`take_id`) REFERENCES `takes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `take_instruments_instrument_id_take_id_idx` ON `take_instruments` (`instrument_id`,`take_id`);--> statement-breakpoint
CREATE TABLE `takes` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`event_id` text NOT NULL,
	`label` text,
	`recorded_at` integer NOT NULL,
	`duration_ms` integer,
	`state` text DEFAULT 'uploading' NOT NULL,
	`keeper_votes` integer DEFAULT 0 NOT NULL,
	`total_votes` integer DEFAULT 0 NOT NULL,
	`rating_score` real DEFAULT 0 NOT NULL,
	`client_ref` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	`purged_at` integer,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `takes_client_ref_unique` ON `takes` (`client_ref`);--> statement-breakpoint
CREATE INDEX `takes_song_id_recorded_at_idx` ON `takes` (`song_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `takes_event_id_recorded_at_idx` ON `takes` (`event_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `takes_state_recorded_at_idx` ON `takes` (`state`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `takes_state_rating_score_idx` ON `takes` (`state`,`rating_score`);--> statement-breakpoint
CREATE TABLE `votes` (
	`take_id` text NOT NULL,
	`member_id` text NOT NULL,
	`keeper` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`take_id`, `member_id`),
	FOREIGN KEY (`take_id`) REFERENCES `takes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `votes_member_id_updated_at_idx` ON `votes` (`member_id`,`updated_at`);