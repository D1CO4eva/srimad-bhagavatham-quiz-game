"use client";

import { useEffect, useRef, useState } from "react";
import { createSessionRealtimeClient } from "@/lib/ably-client";
import {
  SessionEvent,
  type AnswerBreakdownPayload,
  type AnswerCountUpdatePayload,
  type LeaderboardEntry,
  type LeaderboardUpdatePayload,
  type PodiumPayload,
  type QuestionLockedPayload,
  type QuestionStartPayload,
  type SettingsUpdatePayload,
} from "@/lib/events";
import { useCountdown } from "@/lib/useCountdown";
import { ANSWER_SHAPES } from "@/lib/answerShapes";
import { AnswerShapeIcon } from "@/components/AnswerShapeIcon";
import type { InboundMessage } from "ably";

type Player = { id: string; nickname: string };

const MEDALS = ["🥇", "🥈", "🥉"];

export function HostLobby({
  pin,
  quizTitle,
  questionCount,
  initialPlayers,
  joinUrl,
  initialStarted,
  initialQuestion,
  initialLocked,
  initialAnsweredCount,
  initialPlayerCount,
  initialPodium,
  initialShowLeaderboard,
  initialShowTimer,
}: {
  pin: string;
  quizTitle: string;
  questionCount: number;
  initialPlayers: Player[];
  joinUrl: string;
  initialStarted: boolean;
  initialQuestion: QuestionStartPayload | null;
  initialLocked: boolean;
  initialAnsweredCount: number;
  initialPlayerCount: number;
  initialPodium: LeaderboardEntry[] | null;
  initialShowLeaderboard: boolean;
  initialShowTimer: boolean;
}) {
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [started, setStarted] = useState(initialStarted);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenPlayerIds = useRef(new Set(initialPlayers.map((player) => player.id)));

  const [question, setQuestion] = useState<QuestionStartPayload | null>(initialQuestion);
  const [locked, setLocked] = useState(initialLocked);
  const [revealedAnswer, setRevealedAnswer] = useState<string | null>(null);
  const [answeredCount, setAnsweredCount] = useState(initialAnsweredCount);
  const [playerCount, setPlayerCount] = useState(initialPlayerCount);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [podium, setPodium] = useState<LeaderboardEntry[] | null>(initialPodium);
  const [isEnding, setIsEnding] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(initialShowLeaderboard);
  const [showTimer, setShowTimer] = useState(initialShowTimer);
  const [isTogglingSettings, setIsTogglingSettings] = useState(false);
  const [answerBreakdown, setAnswerBreakdown] = useState<AnswerBreakdownPayload | null>(null);

  // Lead-time countdown: seconds until answer choices reveal. Reuses
  // useCountdown with startedAt as the base and the lead-time gap (derived
  // from the two server timestamps) as the duration.
  const leadDurationSecs =
    question?.startedAt != null && question?.optionsRevealedAt != null
      ? (question.optionsRevealedAt - question.startedAt) / 1000
      : 0;
  const leadRemaining = useCountdown(question?.startedAt ?? null, leadDurationSecs);
  const optionsVisible = question !== null && leadRemaining <= 0;

  const liveRemaining = useCountdown(question?.optionsRevealedAt ?? null, question?.timeLimitSecs ?? 0);
  // Frozen the instant the question locks (captured in the onQuestionLocked
  // handler below), so the displayed number stops instead of continuing to
  // tick down off the wall clock after answering has closed.
  const [frozenRemaining, setFrozenRemaining] = useState<number | null>(null);
  // Kept in sync via effect (not read during render) so the lock handler
  // below can read the latest value without a stale closure.
  const liveRemainingRef = useRef(liveRemaining);
  useEffect(() => {
    liveRemainingRef.current = liveRemaining;
  }, [liveRemaining]);

  const remaining = locked ? (frozenRemaining ?? liveRemaining) : liveRemaining;
  const isLastQuestion = question !== null && question.questionIndex === questionCount - 1;

  useEffect(() => {
    const client = createSessionRealtimeClient(pin, "host");
    const channel = client.channels.get(`game:${pin}`);

    const onPlayerJoined = (message: InboundMessage) => {
      const data = message.data as { playerId: string; nickname: string; playerCount: number };
      if (!seenPlayerIds.current.has(data.playerId)) {
        seenPlayerIds.current.add(data.playerId);
        setPlayers((prev) => [...prev, { id: data.playerId, nickname: data.nickname }]);
      }
      setPlayerCount(data.playerCount);
    };
    const onQuestionStart = (message: InboundMessage) => {
      const data = message.data as QuestionStartPayload;
      setQuestion(data);
      setLocked(false);
      setRevealedAnswer(null);
      setFrozenRemaining(null);
      setAnsweredCount(0);
      setLeaderboard(null);
      setAnswerBreakdown(null);
    };
    const onAnswerCountUpdate = (message: InboundMessage) => {
      const data = message.data as AnswerCountUpdatePayload;
      setAnsweredCount(data.answeredCount);
      setPlayerCount(data.playerCount);
    };
    const onQuestionLocked = (message: InboundMessage) => {
      const data = message.data as QuestionLockedPayload;
      setLocked(true);
      setFrozenRemaining(liveRemainingRef.current);
      setRevealedAnswer(data.answer);
    };
    const onLeaderboardUpdate = (message: InboundMessage) => {
      setLeaderboard((message.data as LeaderboardUpdatePayload).leaderboard);
    };
    const onPodium = (message: InboundMessage) => {
      setPodium((message.data as PodiumPayload).podium);
    };
    const onSettingsUpdate = (message: InboundMessage) => {
      const data = message.data as SettingsUpdatePayload;
      setShowLeaderboard(data.showLeaderboard);
      setShowTimer(data.showTimer);
    };
    const onAnswerBreakdown = (message: InboundMessage) => {
      setAnswerBreakdown(message.data as AnswerBreakdownPayload);
    };

    channel.subscribe(SessionEvent.PlayerJoined, onPlayerJoined);
    channel.subscribe(SessionEvent.QuestionStart, onQuestionStart);
    channel.subscribe(SessionEvent.AnswerCountUpdate, onAnswerCountUpdate);
    channel.subscribe(SessionEvent.QuestionLocked, onQuestionLocked);
    channel.subscribe(SessionEvent.LeaderboardUpdate, onLeaderboardUpdate);
    channel.subscribe(SessionEvent.Podium, onPodium);
    channel.subscribe(SessionEvent.SettingsUpdate, onSettingsUpdate);
    channel.subscribe(SessionEvent.AnswerBreakdown, onAnswerBreakdown);

    return () => {
      channel.unsubscribe(SessionEvent.PlayerJoined, onPlayerJoined);
      channel.unsubscribe(SessionEvent.QuestionStart, onQuestionStart);
      channel.unsubscribe(SessionEvent.AnswerCountUpdate, onAnswerCountUpdate);
      channel.unsubscribe(SessionEvent.QuestionLocked, onQuestionLocked);
      channel.unsubscribe(SessionEvent.LeaderboardUpdate, onLeaderboardUpdate);
      channel.unsubscribe(SessionEvent.Podium, onPodium);
      channel.unsubscribe(SessionEvent.SettingsUpdate, onSettingsUpdate);
      channel.unsubscribe(SessionEvent.AnswerBreakdown, onAnswerBreakdown);
      client.close();
    };
  }, [pin]);

  // Auto-lock once the host's own countdown hits zero, so the UI moves on
  // even if no one clicks "Lock Now". The server deadline is authoritative
  // either way (Story 3.3).
  useEffect(() => {
    if (question && remaining === 0 && !locked) {
      fetch(`/api/sessions/${pin}/lock`, { method: "POST" }).catch(() => {});
    }
  }, [remaining, question, pin, locked]);

  async function handleStart() {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${pin}/start`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start the game.");
      setStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the game.");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleNext() {
    setIsAdvancing(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${pin}/next`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not advance the question.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not advance the question.");
    } finally {
      setIsAdvancing(false);
    }
  }

  async function handleLock() {
    await fetch(`/api/sessions/${pin}/lock`, { method: "POST" }).catch(() => {});
  }

  async function handleToggleSetting(setting: "showLeaderboard" | "showTimer") {
    const next = setting === "showLeaderboard" ? !showLeaderboard : !showTimer;
    setIsTogglingSettings(true);
    try {
      const response = await fetch(`/api/sessions/${pin}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [setting]: next }),
      });
      if (response.ok) {
        if (setting === "showLeaderboard") setShowLeaderboard(next);
        else setShowTimer(next);
      }
    } catch {
      // Ably's SettingsUpdate broadcast is the fallback source of truth if this request fails.
    } finally {
      setIsTogglingSettings(false);
    }
  }

  async function handleEndGame() {
    if (!window.confirm("End this game for everyone and show the final results?")) return;
    setIsEnding(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${pin}/end`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not end the game.");
      if (data.podium) setPodium(data.podium);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not end the game.");
    } finally {
      setIsEnding(false);
    }
  }

  // Available on every host screen — pin-sharing, mid-question, and podium —
  // so the host is never stuck without a way back to /host. A normal
  // in-flow button at the bottom, not fixed, so it never overlaps content.
  const endGameButton = (
    <button
      type="button"
      onClick={handleEndGame}
      disabled={isEnding}
      className="btn btn-secondary text-danger"
    >
      {isEnding ? "Ending…" : "End Game"}
    </button>
  );

  if (podium) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-8 px-6 text-center">
        <span className="pill-badge">{quizTitle}</span>
        <h1 className="text-5xl">Final Results</h1>
        <ol className="flex w-full flex-col gap-3">
          {podium.map((entry) => (
            <li key={entry.playerId} className="card flex items-center justify-between gap-4 px-6 py-5">
              <span className="flex items-center gap-3 font-serif text-xl text-brand-ink">
                <span className="text-2xl">{MEDALS[entry.rank - 1] ?? `#${entry.rank}`}</span>
                {entry.nickname}
              </span>
              <span className="font-serif text-2xl font-bold text-brand">{entry.points}</span>
            </li>
          ))}
        </ol>
        {error && <p className="text-sm text-danger">{error}</p>}
        {endGameButton}
      </div>
    );
  }

  if (started && question) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-6 px-6 py-16 text-center">
        <div className="flex w-full items-center justify-between gap-3">
          <span className="pill-badge">
            Question {question.questionIndex + 1} of {questionCount}
          </span>
          <div className="flex items-center gap-3 text-xs font-semibold text-ink-soft">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showLeaderboard}
                disabled={isTogglingSettings}
                onChange={() => handleToggleSetting("showLeaderboard")}
              />
              Leaderboard
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showTimer}
                disabled={isTogglingSettings}
                onChange={() => handleToggleSetting("showTimer")}
              />
              Timer
            </label>
          </div>
        </div>
        <h1 className="max-w-2xl text-4xl">{question.question}</h1>
        {!optionsVisible ? (
          <p className="pill-badge">Answer choices in {leadRemaining}…</p>
        ) : (
          <>
            {showTimer && <p className="font-serif text-6xl font-bold text-brand">{remaining}</p>}
            <ul className="grid w-full grid-cols-2 gap-3">
              {question.choices.map((choice, index) => {
                const isCorrect = revealedAnswer !== null && choice === revealedAnswer;
                const isRevealed = revealedAnswer !== null;
                return (
                  <li
                    key={index}
                    className={`flex items-center gap-3 rounded-2xl px-5 py-4 text-left text-2xl font-semibold text-white shadow-lg transition-all duration-500 md:text-3xl ${
                      isRevealed && !isCorrect ? "opacity-30" : ""
                    } ${isCorrect ? "ring-4 ring-success" : ""}`}
                    style={{ backgroundColor: ANSWER_SHAPES[index % ANSWER_SHAPES.length].color }}
                  >
                    <AnswerShapeIcon
                      label={ANSWER_SHAPES[index % ANSWER_SHAPES.length].label}
                      className="h-7 w-7 shrink-0"
                    />
                    <span className="answer-tile-text">{choice}</span>
                    {isCorrect && <span className="ml-1">✓</span>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="pill-badge">
          {answeredCount} / {playerCount} answered
        </p>

        {locked && answerBreakdown && (answerBreakdown.correctCount > 0 || answerBreakdown.incorrectCount > 0) && (
          <div className="w-full max-w-sm">
            <p className="mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">Correct vs Incorrect</p>
            {(() => {
              const total = answerBreakdown.correctCount + answerBreakdown.incorrectCount;
              const correctPct = Math.round((answerBreakdown.correctCount / total) * 100);
              const incorrectPct = 100 - correctPct;
              return (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-left text-sm font-semibold text-success">Correct</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-full bg-paper-deep">
                      <div
                        className="h-full rounded-full bg-success transition-all duration-500"
                        style={{ width: `${correctPct}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-sm font-semibold">{answerBreakdown.correctCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-left text-sm font-semibold text-danger">Incorrect</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-full bg-paper-deep">
                      <div
                        className="h-full rounded-full bg-danger transition-all duration-500"
                        style={{ width: `${incorrectPct}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-sm font-semibold">{answerBreakdown.incorrectCount}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {showLeaderboard && locked && leaderboard && (
          <div className="w-full max-w-sm">
            <p className="mb-2 text-sm font-bold tracking-wide text-ink-soft uppercase">Top 5</p>
            <ol className="flex flex-col gap-2">
              {leaderboard.map((entry) => (
                <li key={entry.playerId} className="card flex items-center justify-between gap-3 px-5 py-3">
                  <span className="flex items-center gap-3 font-medium text-brand-ink">
                    <span className="w-6 text-lg">{MEDALS[entry.rank - 1] ?? `#${entry.rank}`}</span>
                    {entry.nickname}
                  </span>
                  <span className="font-serif text-lg font-bold text-brand">{entry.points}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {locked ? (
          <button type="button" onClick={handleNext} disabled={isAdvancing || isLastQuestion} className="btn btn-primary">
            {isLastQuestion ? "Ending game…" : isAdvancing ? "Loading…" : "Next Question"}
          </button>
        ) : (
          <button type="button" onClick={handleLock} className="btn btn-secondary">
            Lock Now
          </button>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        {endGameButton}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <span className="pill-badge">{quizTitle}</span>
        <p className="mt-3 text-sm text-ink-soft">Join at {joinUrl}</p>
      </div>
      <p className="font-serif text-8xl font-bold tracking-widest text-brand">{pin}</p>

      {started ? (
        <button type="button" onClick={handleNext} disabled={isAdvancing} className="btn btn-primary">
          {isAdvancing ? "Loading…" : "Next Question"}
        </button>
      ) : (
        <button type="button" onClick={handleStart} disabled={players.length === 0 || isStarting} className="btn btn-primary">
          {isStarting ? "Starting…" : "Start Game"}
        </button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="w-full">
        <p className="mb-3 text-sm font-bold tracking-wide text-ink-soft uppercase">
          {players.length} player{players.length === 1 ? "" : "s"} joined
        </p>
        <ul className="flex flex-wrap justify-center gap-2">
          {players.map((player) => (
            <li key={player.id} className="pill-badge">
              {player.nickname}
            </li>
          ))}
        </ul>
      </div>

      {endGameButton}
    </div>
  );
}
