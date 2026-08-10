-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('LOBBY', 'ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "question" TEXT NOT NULL,
    "choices" TEXT[],
    "answer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "timeLimitSecs" INTEGER NOT NULL DEFAULT 20,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'LOBBY',
    "quizId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "currentQuestionIndex" INTEGER NOT NULL DEFAULT -1,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSessionQuestion" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "question" TEXT NOT NULL,
    "choices" TEXT[],
    "answer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "timeLimitSecs" INTEGER NOT NULL,

    CONSTRAINT "GameSessionQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Question_quizId_order_key" ON "Question"("quizId", "order");

-- CreateIndex
CREATE INDEX "GameSession_pin_idx" ON "GameSession"("pin");

-- CreateIndex
CREATE UNIQUE INDEX "GameSessionQuestion_gameSessionId_order_key" ON "GameSessionQuestion"("gameSessionId", "order");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSessionQuestion" ADD CONSTRAINT "GameSessionQuestion_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
