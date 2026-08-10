import { db } from "@/lib/db";
import { publishToSession } from "@/lib/ably";
import { SessionEvent } from "@/lib/events";
import { computePoints, computeRawReactionTimeMs, computeTrueReactionTimeMs } from "@/lib/scoring";
import { addPoints, finalizeSession, publishLeaderboardUpdate } from "@/lib/leaderboard";

export class QuestionFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionFlowError";
  }
}

/** Public shape sent to clients — never includes `answer`/`explanation` (Story 3.2/3.4 integrity). */
function toPublicQuestion(question: {
  id: string;
  order: number;
  type: string;
  question: string;
  choices: string[];
  timeLimitSecs: number;
  startedAt: Date | null;
}) {
  return {
    questionId: question.id,
    questionIndex: question.order,
    type: question.type,
    question: question.question,
    choices: question.choices,
    timeLimitSecs: question.timeLimitSecs,
    startedAt: question.startedAt?.getTime() ?? null,
  };
}

/**
 * Advances a session to its next question (or the first, from the lobby's
 * post-start state) and broadcasts question_start with a server timestamp
 * clients use to sync their countdowns (Story 3.1, 3.3).
 */
export async function advanceToNextQuestion(pin: string) {
  const session = await db.gameSession.findFirst({
    where: { pin, status: "ACTIVE" },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!session) throw new QuestionFlowError(`No active session for PIN ${pin}.`);

  const nextIndex = session.currentQuestionIndex + 1;
  const nextQuestion = session.questions[nextIndex];
  if (!nextQuestion) throw new QuestionFlowError("No more questions in this session.");

  const startedAt = new Date();
  await db.$transaction([
    db.gameSession.update({
      where: { id: session.id },
      data: { currentQuestionIndex: nextIndex },
    }),
    db.gameSessionQuestion.update({
      where: { id: nextQuestion.id },
      data: { startedAt },
    }),
  ]);

  const payload = toPublicQuestion({ ...nextQuestion, startedAt });
  await publishToSession(pin, SessionEvent.QuestionStart, payload);
  return payload;
}

/**
 * Locks the session's current question so late taps are rejected client-side
 * too, and broadcasts question_locked. The server's deadline check in
 * submitAnswer is the real authority regardless of whether this ever runs
 * (Story 3.3) — this just gives clients a clean "time's up" signal, whether
 * triggered by the host's Lock Now button or their countdown hitting zero.
 *
 * Once locked, this is also the session's "grading window closed" moment
 * (Story 5.1): the leaderboard broadcasts here, and if this was the last
 * question, the session is finalized straight into the podium (Story 5.3).
 */
export async function lockCurrentQuestion(pin: string) {
  const session = await db.gameSession.findFirst({
    where: { pin, status: "ACTIVE" },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  const current = session?.questions[session.currentQuestionIndex];
  if (!session || !current) throw new QuestionFlowError(`No live question for PIN ${pin}.`);

  if (!current.lockedAt) {
    await db.gameSessionQuestion.update({
      where: { id: current.id },
      data: { lockedAt: new Date() },
    });
  }
  await publishToSession(pin, SessionEvent.QuestionLocked, { questionId: current.id });
  await publishLeaderboardUpdate(pin);

  const isLastQuestion = current.order === session.questions.length - 1;
  if (isLastQuestion) {
    await finalizeSession(pin);
  }
}

export class AnswerRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerRejectedError";
  }
}

/**
 * Records and grades a player's answer for the session's current question.
 * Rejects anything after the server-computed deadline regardless of client
 * state (Story 3.3), and rejects a second submission for the same question
 * (Story 3.4 / QA 9.1 rapid-double-submit case). Grading uses only
 * server-received timestamps (Story 4.1) — nothing client-submitted about
 * timing is ever trusted.
 */
export async function submitAnswer(pin: string, playerId: string, questionId: string, choiceIndex: number) {
  const session = await db.gameSession.findFirst({
    where: { pin, status: "ACTIVE" },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  const current = session?.questions[session.currentQuestionIndex];
  if (!session || !current || current.id !== questionId) {
    throw new AnswerRejectedError("That question is not currently live.");
  }
  if (!current.startedAt) {
    throw new AnswerRejectedError("That question hasn't started yet.");
  }
  const deadline = current.startedAt.getTime() + current.timeLimitSecs * 1000;
  const serverReceivedAt = new Date();
  if (current.lockedAt || serverReceivedAt.getTime() > deadline) {
    throw new AnswerRejectedError("The question is locked.");
  }
  if (choiceIndex < 0 || choiceIndex >= current.choices.length) {
    throw new AnswerRejectedError("choiceIndex is out of range.");
  }

  const player = await db.player.findUnique({
    where: { id: playerId },
    select: { gameSessionId: true, estimatedLatencyMs: true },
  });
  if (!player || player.gameSessionId !== session.id) {
    throw new AnswerRejectedError("Player does not belong to this session.");
  }

  const timeLimitMs = current.timeLimitSecs * 1000;
  const rawReactionTimeMs = computeRawReactionTimeMs(serverReceivedAt.getTime(), current.startedAt.getTime());
  const trueReactionTimeMs = computeTrueReactionTimeMs(
    rawReactionTimeMs,
    player.estimatedLatencyMs ?? 0,
    timeLimitMs
  );
  const correct = current.choices[choiceIndex] === current.answer;
  const points = computePoints(correct, trueReactionTimeMs, timeLimitMs);

  try {
    await db.answer.create({
      data: {
        gameSessionQuestionId: current.id,
        playerId,
        choiceIndex,
        serverReceivedAt,
        correct,
        points,
        rawReactionTimeMs,
        trueReactionTimeMs,
      },
    });
  } catch {
    throw new AnswerRejectedError("You already answered this question.");
  }

  await addPoints(pin, playerId, points);

  const answeredCount = await db.answer.count({ where: { gameSessionQuestionId: current.id } });
  const playerCount = await db.player.count({ where: { gameSessionId: session.id } });
  await publishToSession(pin, SessionEvent.AnswerCountUpdate, { answeredCount, playerCount });
}
