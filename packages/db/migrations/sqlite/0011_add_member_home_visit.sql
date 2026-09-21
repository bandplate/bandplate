-- Home's "new since your last visit": when this member's current visit to home
-- began, and when the one before it began. A visit is a stretch of activity;
-- a load more than 30 minutes after `home_visit_started_at` starts the next
-- one (see `decideHomeVisit` in `apps/web/src/server/pages/home-visit.ts`).
--
-- Nullable, with no default and no backfill: NULL is "never opened home",
-- which is exactly true of every existing member, and the loader falls back to
-- the member's `created_at` or the last 14 days for that first visit.
--
-- Plain `ADD COLUMN`s, never a rebuild: on D1 a `DROP TABLE members` would
-- cascade. Declared last on the table, after `locale`, because
-- `membersRepo.buildCreateIfEmptyStatement` writes a positional insert and
-- `assertColumnCount(members, 11)` is what fails loudly if the two drift.
ALTER TABLE `members` ADD `home_visit_started_at` integer;--> statement-breakpoint
ALTER TABLE `members` ADD `home_last_visit_at` integer;
