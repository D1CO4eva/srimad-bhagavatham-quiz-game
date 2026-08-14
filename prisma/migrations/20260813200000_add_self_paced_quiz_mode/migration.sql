-- CreateEnum
CREATE TYPE "QuizMode" AS ENUM ('LIVE', 'SELF_PACED');

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN "mode" "QuizMode" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "Quiz" ADD COLUMN "slug" TEXT;
ALTER TABLE "Quiz" ADD COLUMN "responsesOpen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quiz" ADD COLUMN "opensAt" TIMESTAMP(3);
ALTER TABLE "Quiz" ADD COLUMN "closesAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Quiz_slug_key" ON "Quiz"("slug");

-- CreateTable
CREATE TABLE "QuizResponse" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "respondentName" TEXT NOT NULL,
    "respondentEmail" TEXT NOT NULL,
    "respondentPhone" TEXT NOT NULL,
    "respondentCountryCode" TEXT NOT NULL,
    "respondentRegNo" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuizResponse_quizId_idx" ON "QuizResponse"("quizId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizResponse_quizId_respondentRegNo_key" ON "QuizResponse"("quizId", "respondentRegNo");

-- AddForeignKey
ALTER TABLE "QuizResponse" ADD CONSTRAINT "QuizResponse_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
