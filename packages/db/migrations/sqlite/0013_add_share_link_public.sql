-- A share link a member has made PUBLIC: `/s/<code>` then shows a signed-out
-- visitor the take or event and plays it, instead of asking them to sign in.
--
-- Nullable, with no default and no backfill: NULL is a members' link, which
-- is exactly what every link sent so far was promised to be. Nothing already
-- shared turns public by this migration.
--
-- A plain `ADD COLUMN`, never a rebuild (on D1 a DROP TABLE cascades; see
-- `src/migration-guard.ts`).
ALTER TABLE `share_links` ADD `public_at` integer;
