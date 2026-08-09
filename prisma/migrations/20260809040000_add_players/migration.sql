-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "estimatedLatencyMs" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Player_gameSessionId_idx" ON "Player"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_gameSessionId_nickname_key" ON "Player"("gameSessionId", "nickname");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
