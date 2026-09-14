-- Other slugs that mean an existing instrument.
--
-- Two jobs, the same job from opposite ends: a bridge that calls it `gtr2`
-- keeps calling it that, and an instrument merged into another leaves its
-- slug behind so the next ingest run resolves it rather than re-inventing the
-- row that was just merged away.
--
-- UNIQUE across the whole table, not per instrument -- this is a lookup key.
-- What the schema cannot say is that it must not collide with
-- `instruments.slug` either; one namespace lives across two tables, so
-- `instrumentsRepo.addAlias` enforces that half and is the only path allowed
-- to write here.
CREATE TABLE `instrument_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`slug` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instrument_aliases_slug_unique` ON `instrument_aliases` (`slug`);