-- The short `/s/<code>` links the Share button on a song, event or take page
-- hands out. One code per target, reused for ever: UNIQUE (kind, target_id).
-- `target_id` is an id, never a path: the page is worked out when the link is
-- opened, so it always lands on the song's current slug.
--
-- A new table only. Nothing existing is rebuilt or dropped (on D1 a DROP
-- TABLE cascades into child tables; see `src/migration-guard.ts`).
CREATE TABLE `share_links` (
	`code` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_kind_target_id_idx` ON `share_links` (`kind`,`target_id`);
