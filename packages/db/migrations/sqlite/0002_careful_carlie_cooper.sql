DROP INDEX `songs_title_norm_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `songs_title_norm_idx` ON `songs` (`title_norm`);