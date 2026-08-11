import { db } from "@/lib/db";
import { generateUniquePin } from "@/lib/pin";
import { publishToSession } from "@/lib/ably";
import { SessionEvent } from "@/lib/events";
import { toPublicQuestion } from "@/lib/questions";
import { finalizeSession } from "@/lib/leaderboard";

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

export class SessionNotFoundError extends Error {
  constructor(pin: string) {
    super(`No session found for PIN ${pin}.`);
    this.name = "SessionNotFoundError";
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

/**
 * Moves a session from LOBBY to ACTIVE once the host clicks "Start Game"
 * (Story 2.3), and immediately advances straight into the first question —
 * the host shouldn't have to click "Start Game" and then a separate "Next
 * Question" just to reach question 1.
 */
export async function startGameSession(pin: string) {
  const session = await db.gameSession.findFirst({
    where: { pin, status: "LOBBY" },
    include: {
      _count: { select: { players: true } },
      questions: { orderBy: { order: "asc" } },
    },
  });
  if (!session || session._count.players < 1) {
    throw new SessionNotStartableError(pin);
  }
  const firstQuestion = session.questions[0];
  if (!firstQuestion) {
    throw new SessionNotStartableError(pin);
  }

  const startedAt = new Date();
  await db.$transaction([
    db.gameSession.update({
      where: { id: session.id },
      data: { status: "ACTIVE", startedAt, currentQuestionIndex: 0 },
    }),
    db.gameSessionQuestion.update({
      where: { id: firstQuestion.id },
      data: { startedAt },
    }),
  ]);

  await publishToSession(pin, SessionEvent.GameStarted, {});
  const payload = toPublicQuestion({ ...firstQuestion, startedAt });
  await publishToSession(pin, SessionEvent.QuestionStart, payload);
  return payload;
}

/**
 * Lets the host end a session early from anywhere in the host flow — before
 * it's started, mid-question, or between questions. Reuses the same
 * finalize path a natural last-question lock takes, so players still get a
 * normal podium/"Game Over" screen instead of being left stuck waiting.
 * A no-op if the session already ended.
 */
export async function endGameSession(pin: string) {
  const session = await db.gameSession.findFirst({ where: { pin }, select: { status: true } });
  if (!session) throw new SessionNotFoundError(pin);
  if (session.status === "COMPLETED") return;
  await finalizeSession(pin);
}
