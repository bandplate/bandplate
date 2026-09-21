-- Home's "new since your last visit": when this member last loaded home, and
-- when their previous visit ended. A visit is a stretch of activity; it ends
-- after 30 minutes with no home load, and the next load starts a new one (see
-- `decideHomeVisit` in `apps/web/src/server/pages/home-visit.ts`).
--
-- Nullable, with no default and no backfill: NULL is "never opened home",
-- which is exactly true of every existing member, and the loader falls back to
-- the member's `created_at` or the last 14 days for that first visit.
--
-- Plain `ADD COLUMN`s, never a rebuild: on D1 a `DROP TABLE members` would
-- cascade. Declared last on the table, after `locale`, because
-- `membersRepo.buildCreateIfEmptyStatement` writes a positional insert and
-- `assertColumnCount(members, 11)` is what fails loudly if the two drift.
ALTER TABLE `members` ADD `home_last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `members` ADD `home_last_visit_at` integer;
