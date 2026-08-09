-- CreateTable
CREATE TABLE "SessionResult" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionResult_gameSessionId_idx" ON "SessionResult"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionResult_gameSessionId_playerId_key" ON "SessionResult"("gameSessionId", "playerId");

-- AddForeignKey
ALTER TABLE "SessionResult" ADD CONSTRAINT "SessionResult_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionResult" ADD CONSTRAINT "SessionResult_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
