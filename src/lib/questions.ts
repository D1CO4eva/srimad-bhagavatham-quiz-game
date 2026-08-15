import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { publishToSession } from "@/lib/ably";
import { SessionEvent, type QuestionStartPayload } from "@/lib/events";
import {
  computeCorrectFraction,
  computePoints,
  computeRawReactionTimeMs,
  computeTrueReactionTimeMs,
} from "@/lib/scoring";
import { addPoints, finalizeSession, publishLeaderboardUpdate } from "@/lib/leaderboard";

export class QuestionFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionFlowError";
  }
}

/** Public shape sent to clients — never includes `answer`/`explanation` (Story 3.2/3.4 integrity). */
export function toPublicQuestion(question: {
  id: string;
  order: number;
  type: QuestionStartPayload["type"];
  question: string;
  choices: string[];
  timeLimitSecs: number;
  startedAt: Date | null;
  optionsRevealedAt?: Date | null;
}): QuestionStartPayload {
  return {
    questionId: question.id,
    questionIndex: question.order,
    type: question.type,
    question: question.question,
    choices: question.choices,
    timeLimitSecs: question.timeLimitSecs,
    startedAt: question.startedAt?.getTime() ?? null,
    optionsRevealedAt: question.optionsRevealedAt?.getTime() ?? null,
  };
}

type QuestionRow = {
  id: string;
  order: number;
  type: QuestionStartPayload["type"];
  question: string;
  choices: string[];
  timeLimitSecs: number;
  startedAt: Date | null;
};

/** Sets startedAt/optionsRevealedAt and broadcasts question_start with a
 * server timestamp clients use to sync their countdowns (Story 3.1, 3.3). */
async function startQuestion(pin: string, leadTimeSecs: number, question: QuestionRow) {
  const startedAt = new Date();
  const optionsRevealedAt = new Date(startedAt.getTime() + leadTimeSecs * 1000);
  await db.gameSessionQuestion.update({
    where: { id: question.id },
    data: { startedAt, optionsRevealedAt },
  });
  const payload = toPublicQuestion({ ...question, startedAt, optionsRevealedAt });
  await publishToSession(pin, SessionEvent.QuestionStart, payload);
  return payload;
}

/**
 * Advances a session to its next question (or the first, from the lobby's
 * post-start state). If the next question has a Sri Swamiji quote assigned
 * (src/lib/swamijiQuotes.ts), this only broadcasts quote_display and
 * advances currentQuestionIndex to it — the question itself doesn't start
 * (no countdown, not visible) until the host explicitly reveals it via
 * revealQuestionAfterQuote below, so there's no auto-advance timer for the
 * host to race against. Returns null in that case; otherwise the question
 * starts immediately and this returns its question_start payload.
 */
export async function advanceToNextQuestion(pin: string): Promise<QuestionStartPayload | null> {
  const session = await db.gameSession.findFirst({
    where: { pin, status: "ACTIVE" },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!session) throw new QuestionFlowError(`No active session for PIN ${pin}.`);

  // A quote is already showing for the current question and the host hasn't
  // revealed it yet — treat "Next" as "reveal it" instead of skipping past
  // it, which currentQuestionIndex + 1 below would otherwise do.
  const current = session.currentQuestionIndex >= 0 ? session.questions[session.currentQuestionIndex] : null;
  if (current && !current.startedAt) {
    return startQuestion(pin, session.leadTimeSecs, current);
  }

  const nextIndex = session.currentQuestionIndex + 1;
  const nextQuestion = session.questions[nextIndex];
  if (!nextQuestion) throw new QuestionFlowError("No more questions in this session.");

  await db.gameSession.update({
    where: { id: session.id },
    data: { currentQuestionIndex: nextIndex },
  });

  if (nextQuestion.quoteText && nextQuestion.quoteAttribution) {
    await publishToSession(pin, SessionEvent.QuoteDisplay, {
      quote: nextQuestion.quoteText,
      attribution: nextQuestion.quoteAttribution,
    });
    return null;
  }

  return startQuestion(pin, session.leadTimeSecs, nextQuestion);
}

/** Reveals the question waiting behind the current quote (host's "Next"
 * button on the quote overlay — see advanceToNextQuestion). Idempotent: a
 * question that's already started (e.g. a duplicate click) is just returned
 * as-is rather than re-started. */
export async function revealQuestionAfterQuote(pin: string): Promise<QuestionStartPayload> {
  const session = await db.gameSession.findFirst({
    where: { pin, status: "ACTIVE" },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  const current = session?.questions[session.currentQuestionIndex];
  if (!session || !current) throw new QuestionFlowError(`No live question for PIN ${pin}.`);
  if (current.startedAt) return toPublicQuestion(current);
  return startQuestion(pin, session.leadTimeSecs, current);
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
  await publishToSession(pin, SessionEvent.QuestionLocked, {
    questionId: current.id,
    correctChoices: current.correctChoices,
  });
  await publishLeaderboardUpdate(pin);

  const breakdown = await db.answer.groupBy({
    by: ["correct"],
    where: { gameSessionQuestionId: current.id },
    _count: true,
  });
  const correctCount = breakdown.find((row) => row.correct)?._count ?? 0;
  const incorrectCount = breakdown.find((row) => !row.correct)?._count ?? 0;

  // Per-choice tally for the host's "answers by choice" bar graph. Tallied
  // in JS rather than a groupBy — choiceIndices is an array (MULTI_SELECT
  // can pick more than one), so a single answer can count toward more than
  // one bucket, which Prisma's groupBy can't express directly.
  const allAnswers = await db.answer.findMany({
    where: { gameSessionQuestionId: current.id },
    select: { choiceIndices: true },
  });
  const choiceCounts = new Array(current.choices.length).fill(0) as number[];
  for (const answer of allAnswers) {
    for (const choiceIndex of answer.choiceIndices) {
      if (choiceIndex >= 0 && choiceIndex < choiceCounts.length) choiceCounts[choiceIndex]++;
    }
  }

  await publishToSession(pin, SessionEvent.AnswerBreakdown, { correctCount, incorrectCount, choiceCounts });

  const isLastQuestion = current.order === session.questions.length - 1;
  if (isLastQuestion) {
    await finalizeSession(pin);
  }
}

const ANSWER_COUNT_THROTTLE_MS = 300;

/**
 * At most one answer_count_update broadcast per session every 300ms. Without
 * this, a burst of answers landing in the same second (everyone tapping just
 * before the deadline) publishes once per answer on one Ably channel, which
 * blows past Ably's per-channel publish-rate limit. A Redis NX lock makes
 * the throttle hold across Cloud Run instances, not just within one.
 */
async function shouldPublishAnswerCountUpdate(pin: string): Promise<boolean> {
  const key = `game:${pin}:answer-count-throttle`;
  const acquired = await redis.set(key, "1", "PX", ANSWER_COUNT_THROTTLE_MS, "NX");
  return acquired === "OK";
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
 * state (Story 3.3) — unless the host has the timer off, in which case the
 * question is free-time and only an explicit lock closes it — and rejects a
 * second submission for the same question (Story 3.4 / QA 9.1
 * rapid-double-submit case). Grading uses only server-received timestamps
 * (Story 4.1) — nothing client-submitted about timing is ever trusted.
 */
export async function submitAnswer(pin: string, playerId: string, questionId: string, choiceIndices: number[]) {
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
  // Reaction time and the answer deadline are both relative to when options
  // actually became visible (startedAt + leadTimeSecs), not when the
  // question text first appeared — falls back to startedAt for any row from
  // before lead-time reveal existed.
  const revealAt = current.optionsRevealedAt ?? current.startedAt;
  const serverReceivedAt = new Date();
  if (serverReceivedAt.getTime() < revealAt.getTime()) {
    throw new AnswerRejectedError("Answer options aren't open yet.");
  }
  const deadline = revealAt.getTime() + current.timeLimitSecs * 1000;
  const timeExpired = session.showTimer && serverReceivedAt.getTime() > deadline;
  if (current.lockedAt || timeExpired) {
    throw new AnswerRejectedError("The question is locked.");
  }
  const uniqueIndices = new Set(choiceIndices);
  if (
    choiceIndices.length === 0 ||
    uniqueIndices.size !== choiceIndices.length ||
    choiceIndices.some((i) => i < 0 || i >= current.choices.length) ||
    (current.type !== "MULTI_SELECT" && choiceIndices.length > 1)
  ) {
    throw new AnswerRejectedError("choiceIndices is invalid for this question.");
  }

  const player = await db.player.findUnique({
    where: { id: playerId },
    select: { gameSessionId: true, estimatedLatencyMs: true },
  });
  if (!player || player.gameSessionId !== session.id) {
    throw new AnswerRejectedError("Player does not belong to this session.");
  }

  const timeLimitMs = current.timeLimitSecs * 1000;
  const rawReactionTimeMs = computeRawReactionTimeMs(serverReceivedAt.getTime(), revealAt.getTime());
  const trueReactionTimeMs = computeTrueReactionTimeMs(
    rawReactionTimeMs,
    player.estimatedLatencyMs ?? 0,
    timeLimitMs
  );
  const correctFraction = computeCorrectFraction(current.choices, current.correctChoices, choiceIndices);
  const correct = correctFraction >= 1;
  const points = computePoints(correctFraction, trueReactionTimeMs, timeLimitMs, session.scoringMode);

  try {
    await db.answer.create({
      data: {
        gameSessionQuestionId: current.id,
        playerId,
        choiceIndices,
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
  if (await shouldPublishAnswerCountUpdate(pin)) {
    await publishToSession(pin, SessionEvent.AnswerCountUpdate, { answeredCount, playerCount });
  }
}
