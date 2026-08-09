-- AlterTable
ALTER TABLE "GameSessionQuestion" ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "gameSessionQuestionId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "choiceIndex" INTEGER NOT NULL,
    "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Answer_gameSessionQuestionId_playerId_key" ON "Answer"("gameSessionQuestionId", "playerId");

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_gameSessionQuestionId_fkey" FOREIGN KEY ("gameSessionQuestionId") REFERENCES "GameSessionQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
