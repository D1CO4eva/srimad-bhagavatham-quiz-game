import { db } from "@/lib/db";
import { generateUniquePin } from "@/lib/pin";
import { publishToSession } from "@/lib/ably";
import { SessionEvent } from "@/lib/events";

export class QuizNotFoundError extends Error {
  constructor(quizId: string) {
    super(`Quiz ${quizId} not found or has no questions.`);
    this.name = "QuizNotFoundError";
  }
}

export class SessionNotStartableError extends Error {
  constructor(pin: string) {
    super(`Session ${pin} cannot be started (not in lobby, or no players joined).`);
    this.name = "SessionNotStartableError";
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

/** Moves a session from LOBBY to ACTIVE once the host clicks "Start Game" (Story 2.3). */
export async function startGameSession(pin: string) {
  const session = await db.gameSession.findFirst({
    where: { pin, status: "LOBBY" },
    include: { _count: { select: { players: true } } },
  });
  if (!session || session._count.players < 1) {
    throw new SessionNotStartableError(pin);
  }

  await db.gameSession.update({
    where: { id: session.id },
    data: { status: "ACTIVE", startedAt: new Date() },
  });

  await publishToSession(pin, SessionEvent.GameStarted, {});
}
