import { db } from "@/lib/db";
import { generateUniquePin } from "@/lib/pin";

export class QuizNotFoundError extends Error {
  constructor(quizId: string) {
    super(`Quiz ${quizId} not found or has no questions.`);
    this.name = "QuizNotFoundError";
  }
}

/**
 * Starts a live session from an existing quiz: generates a PIN and freezes a
 * snapshot of the quiz's current questions so later edits to the quiz don't
 * affect this session (Story 1.2).
 */
export async function createGameSession(quizId: string) {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!quiz || quiz.questions.length === 0) {
    throw new QuizNotFoundError(quizId);
  }

  const pin = await generateUniquePin();

  return db.gameSession.create({
    data: {
      pin,
      quizId: quiz.id,
      status: "LOBBY",
      questions: {
        create: quiz.questions.map((question) => ({
          order: question.order,
          type: question.type,
          question: question.question,
          choices: question.choices,
          answer: question.answer,
          explanation: question.explanation,
          timeLimitSecs: question.timeLimitSecs,
        })),
      },
    },
    include: { questions: { orderBy: { order: "asc" } } },
  });
}
