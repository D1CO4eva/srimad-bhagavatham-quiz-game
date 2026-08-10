-- AlterTable
ALTER TABLE "Answer" ADD COLUMN     "correct" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rawReactionTimeMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trueReactionTimeMs" INTEGER NOT NULL DEFAULT 0;

-- Defaults above exist only to backfill any pre-existing rows; new inserts
-- always supply real graded values, so the column-level defaults are
-- otherwise inert.
ALTER TABLE "Answer" ALTER COLUMN "correct" DROP DEFAULT;
ALTER TABLE "Answer" ALTER COLUMN "points" DROP DEFAULT;
ALTER TABLE "Answer" ALTER COLUMN "rawReactionTimeMs" DROP DEFAULT;
ALTER TABLE "Answer" ALTER COLUMN "trueReactionTimeMs" DROP DEFAULT;
