-- CreateEnum
CREATE TYPE "ScoringMode" AS ENUM ('SPEED', 'ACCURACY');

-- AlterTable
ALTER TABLE "Quiz"
  ADD COLUMN "showLeaderboardDefault" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showTimerDefault" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "scoringMode" "ScoringMode" NOT NULL DEFAULT 'SPEED';

-- AlterTable
ALTER TABLE "GameSession"
  ADD COLUMN "showLeaderboard" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showTimer" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "scoringMode" "ScoringMode" NOT NULL DEFAULT 'SPEED';
