-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'MULTI_SELECT';

-- Question.answer (String) -> Question.correctChoices (String[])
ALTER TABLE "Question" ADD COLUMN "correctChoices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Question" SET "correctChoices" = ARRAY["answer"];
ALTER TABLE "Question" ALTER COLUMN "correctChoices" DROP DEFAULT;
ALTER TABLE "Question" DROP COLUMN "answer";

-- GameSessionQuestion.answer (String) -> GameSessionQuestion.correctChoices (String[])
ALTER TABLE "GameSessionQuestion" ADD COLUMN "correctChoices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "GameSessionQuestion" SET "correctChoices" = ARRAY["answer"];
ALTER TABLE "GameSessionQuestion" ALTER COLUMN "correctChoices" DROP DEFAULT;
ALTER TABLE "GameSessionQuestion" DROP COLUMN "answer";

-- Answer.choiceIndex (Int) -> Answer.choiceIndices (Int[])
ALTER TABLE "Answer" ADD COLUMN "choiceIndices" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
UPDATE "Answer" SET "choiceIndices" = ARRAY["choiceIndex"];
ALTER TABLE "Answer" ALTER COLUMN "choiceIndices" DROP DEFAULT;
ALTER TABLE "Answer" DROP COLUMN "choiceIndex";
