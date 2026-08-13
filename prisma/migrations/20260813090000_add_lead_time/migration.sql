-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN "leadTimeSecs" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN "leadTimeSecs" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "GameSessionQuestion" ADD COLUMN "optionsRevealedAt" TIMESTAMP(3);
