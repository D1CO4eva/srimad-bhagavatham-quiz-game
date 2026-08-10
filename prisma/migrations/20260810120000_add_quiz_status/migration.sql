-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT';
