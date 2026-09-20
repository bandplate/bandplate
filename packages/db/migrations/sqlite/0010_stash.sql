-- The stash (Šuplík). A take can now be private to one member and can reach
-- the stash BEFORE its member has decided what song it is, and an event can be
-- one member's personal day. Every existing row keeps meaning what it meant:
-- `visibility` defaults to 'band', both owner columns are NULL, every archived
-- take keeps its song. No backfill statement is needed for that;
-- `migration-0010-stash.test.ts` proves it on a populated db.
--
-- `takes.song_id` becomes nullable, and the invariant moves into code
-- (`takesRepo.create`, `publishFromStash`): a take with `visibility = 'band'`
-- ALWAYS has a song, so no band listing, count or search can meet a songless
-- row.
--
-- SQLite cannot drop a NOT NULL in place, so `takes` gets the documented
-- 12-step table rebuild — which is what `drizzle-kit generate` produces, and
-- which COPIES every row rather than losing it. The two new columns are added
-- by the same rebuild (NULL owner, 'band' visibility for every copied row)
-- instead of by a separate ALTER, so this migration touches the table once.
-- Two things were hand-added to the generated file, and both matter:
--
--   1. `takes_push_pending_idx` — the raw partial index from 0009, which is
--      not expressible in drizzle-kit's schema DSL and therefore absent from
--      the snapshot. `DROP TABLE takes` takes it with it, and the generator
--      has no idea it existed. Without the line at the bottom,
--      `notificationsRepo.listPendingTakeBatches` quietly goes back to
--      scanning the whole table.
--   2. The comment you are reading, so the next rebuild does not repeat (1).
--
-- The `PRAGMA foreign_keys` pair is the generator's and stays. The rebuild
-- needs it off (with enforcement on, `DROP TABLE takes` fires an implicit
-- DELETE that every vote and asset row would refuse), and the closing `ON`
-- only ever touches the migration's own connection — the one `scripts/
-- migrate.ts` closes on the next line, and the one `createTestDb` hands to
-- the tests, whose foreign keys were already on.
--
-- `events.kind = 'personal'` and the `webm` / `m4a` asset formats are text
-- enums in the schema DSL only: SQLite stores them as plain text with no
-- CHECK, so they need no DDL here.
ALTER TABLE `events` ADD `owner_member_id` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_takes` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text,
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
	`push_batched_at` integer,
	`owner_member_id` text,
	`visibility` text DEFAULT 'band' NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_takes`("id", "song_id", "event_id", "label", "recorded_at", "duration_ms", "state", "keeper_votes", "total_votes", "rating_score", "client_ref", "notes", "created_at", "updated_at", "published_at", "purged_at", "push_batched_at", "owner_member_id", "visibility") SELECT "id", "song_id", "event_id", "label", "recorded_at", "duration_ms", "state", "keeper_votes", "total_votes", "rating_score", "client_ref", "notes", "created_at", "updated_at", "published_at", "purged_at", "push_batched_at", NULL, 'band' FROM `takes`;--> statement-breakpoint
DROP TABLE `takes`;--> statement-breakpoint
ALTER TABLE `__new_takes` RENAME TO `takes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `takes_client_ref_unique` ON `takes` (`client_ref`);--> statement-breakpoint
CREATE INDEX `takes_song_id_recorded_at_idx` ON `takes` (`song_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `takes_event_id_recorded_at_idx` ON `takes` (`event_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `takes_state_recorded_at_idx` ON `takes` (`state`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `takes_state_rating_score_idx` ON `takes` (`state`,`rating_score`);--> statement-breakpoint
CREATE INDEX `takes_owner_member_id_visibility_recorded_at_idx` ON `takes` (`owner_member_id`,`visibility`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `takes_push_pending_idx` ON `takes` (`event_id`,`published_at`) WHERE `push_batched_at` IS NULL AND `published_at` IS NOT NULL;
