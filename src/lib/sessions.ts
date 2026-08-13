import { db } from "@/lib/db";
import { generateUniquePin } from "@/lib/pin";
import { publishToSession } from "@/lib/ably";
import { SessionEvent, type SettingsUpdatePayload } from "@/lib/events";
import { toPublicQuestion } from "@/lib/questions";
import { finalizeSession } from "@/lib/leaderboard";
import { buildQuoteAssignment } from "@/lib/swamijiQuotes";

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
  // Fixed once per session, alongside the rest of the frozen question
  // snapshot, so a quote's position/text doesn't change if this is re-read.
  const quoteAssignment = buildQuoteAssignment(quiz.questions.length);

  return db.gameSession.create({
    data: {
      pin,
      quizId: quiz.id,
      status: "LOBBY",
      showLeaderboard: quiz.showLeaderboardDefault,
      showTimer: quiz.showTimerDefault,
      scoringMode: quiz.scoringMode,
      leadTimeSecs: quiz.leadTimeSecs,
      questions: {
        create: quiz.questions.map((question) => ({
          order: question.order,
          type: question.type,
          question: question.question,
          choices: question.choices,
          correctChoices: question.correctChoices,
          explanation: question.explanation,
          timeLimitSecs: question.timeLimitSecs,
          quoteText: quoteAssignment.get(question.order)?.quote ?? null,
          quoteAttribution: quoteAssignment.get(question.order)?.attribution ?? null,
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
  const optionsRevealedAt = new Date(startedAt.getTime() + session.leadTimeSecs * 1000);
  await db.$transaction([
    db.gameSession.update({
      where: { id: session.id },
      data: { status: "ACTIVE", startedAt, currentQuestionIndex: 0 },
    }),
    db.gameSessionQuestion.update({
      where: { id: firstQuestion.id },
      data: { startedAt, optionsRevealedAt },
    }),
  ]);

  await publishToSession(pin, SessionEvent.GameStarted, {});
  const payload = toPublicQuestion({ ...firstQuestion, startedAt, optionsRevealedAt });
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
  if (session.status === "COMPLETED") return null;
  return finalizeSession(pin);
}

/**
 * Live mid-game override for the leaderboard/timer visibility toggles the
 * host sees on the question screen — separate from the Quiz's authoring-time
 * defaults, so flipping this never rewrites the quiz itself.
 */
export async function updateSessionSettings(
  pin: string,
  settings: Partial<SettingsUpdatePayload>
) {
  const session = await db.gameSession.findFirst({ where: { pin }, select: { id: true } });
  if (!session) throw new SessionNotFoundError(pin);

  const updated = await db.gameSession.update({
    where: { id: session.id },
    data: settings,
    select: { showLeaderboard: true, showTimer: true },
  });

  await publishToSession(pin, SessionEvent.SettingsUpdate, updated);
  return updated;
}
